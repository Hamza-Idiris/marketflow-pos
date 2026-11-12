-- Support access grants: A super admin must not see a supermarket's detailed data by default.
-- Detailed data is visible only while an approved, unexpired, audited access grant exists.

-- 1. Table access_grants
create table if not exists public.access_grants (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  requested_by uuid not null references public.profiles (id),
  reason text not null check (char_length(btrim(reason)) >= 5),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'revoked')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists access_grants_store_idx on public.access_grants (supermarket_id, status);
create index if not exists access_grants_req_idx on public.access_grants (requested_by, status);

alter table public.access_grants enable row level security;

-- RLS: select for the requesting super admin and for admins of that store. No direct writes.
drop policy if exists access_grants_select on public.access_grants;
create policy access_grants_select on public.access_grants for select to authenticated using (
  (requested_by = auth.uid() and public.is_super_admin())
  or public.has_store_role(supermarket_id, array['admin']::public.app_role[])
);

revoke all on public.access_grants from public, anon;
grant select on public.access_grants to authenticated;

-- 2. Helper function: can_view_store_details(sid)
-- active store admin of sid OR (super admin AND an approved, unexpired grant for sid owned by auth.uid()).
create or replace function public.can_view_store_details(sid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_store_role(sid, array['admin']::public.app_role[])
    or (
      public.is_super_admin()
      and exists (
        select 1 from public.access_grants g
        where g.supermarket_id = sid
          and g.requested_by = auth.uid()
          and g.status = 'approved'
          and g.expires_at > now()
      )
    );
$$;

grant execute on function public.can_view_store_details(uuid) to authenticated;

-- 3. RPCs (security definer, search_path='')
-- request_access(p_store, p_reason): super admin only; one pending request per store.
create or replace function public.request_access(p_store uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_trimmed text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_super_admin() then
    raise exception 'only super admins can request store access' using errcode = '42501';
  end if;
  if char_length(v_trimmed) < 5 then
    raise exception 'reason must be at least 5 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.supermarkets where id = p_store) then
    raise exception 'supermarket not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.access_grants
    where supermarket_id = p_store and requested_by = auth.uid() and status = 'pending'
  ) then
    raise exception 'a pending request already exists for this supermarket' using errcode = '23505';
  end if;

  insert into public.access_grants (supermarket_id, requested_by, reason, status)
  values (p_store, auth.uid(), v_trimmed, 'pending')
  returning id into v_id;

  perform public.write_audit(p_store, 'access.requested', 'access_grant', v_id,
    jsonb_build_object('reason', v_trimmed, 'requested_by', auth.uid()));
  return v_id;
end $$;

-- decide_access(p_id, p_approve boolean, p_hours int): admin of THAT store only; hours 1..72 (default 24); sets expires_at.
create or replace function public.decide_access(p_id uuid, p_approve boolean, p_hours int default 24)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_grant public.access_grants;
  v_hours int := coalesce(p_hours, 24);
  v_expires timestamptz;
begin
  select * into v_grant from public.access_grants where id = p_id for update;
  if not found then
    raise exception 'access request not found' using errcode = 'P0002';
  end if;
  if v_grant.status <> 'pending' then
    raise exception 'request is no longer pending' using errcode = '22023';
  end if;
  if not public.has_store_role(v_grant.supermarket_id, array['admin']::public.app_role[]) then
    raise exception 'only an administrator of this supermarket can decide access requests' using errcode = '42501';
  end if;

  if p_approve then
    if v_hours < 1 or v_hours > 72 then
      raise exception 'hours must be between 1 and 72' using errcode = '22023';
    end if;
    v_expires := now() + (v_hours || ' hours')::interval;
    update public.access_grants
    set status = 'approved', decided_by = auth.uid(), decided_at = now(), expires_at = v_expires
    where id = p_id;

    perform public.write_audit(v_grant.supermarket_id, 'access.approved', 'access_grant', p_id,
      jsonb_build_object('hours', v_hours, 'expires_at', v_expires, 'requested_by', v_grant.requested_by));
  else
    update public.access_grants
    set status = 'denied', decided_by = auth.uid(), decided_at = now(), expires_at = null
    where id = p_id;

    perform public.write_audit(v_grant.supermarket_id, 'access.denied', 'access_grant', p_id,
      jsonb_build_object('requested_by', v_grant.requested_by));
  end if;
end $$;

-- revoke_access(p_id): store admin or the super admin who holds it.
create or replace function public.revoke_access(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_grant public.access_grants;
begin
  select * into v_grant from public.access_grants where id = p_id for update;
  if not found then
    raise exception 'access grant not found' using errcode = 'P0002';
  end if;
  if v_grant.status not in ('pending', 'approved') then
    raise exception 'access grant is already finished' using errcode = '22023';
  end if;

  if not (
    (v_grant.requested_by = auth.uid() and public.is_super_admin())
    or public.has_store_role(v_grant.supermarket_id, array['admin']::public.app_role[])
  ) then
    raise exception 'not allowed to revoke this access grant' using errcode = '42501';
  end if;

  update public.access_grants
  set status = 'revoked', expires_at = least(expires_at, now())
  where id = p_id;

  perform public.write_audit(v_grant.supermarket_id, 'access.revoked', 'access_grant', p_id,
    jsonb_build_object('revoked_by', auth.uid()));
end $$;

grant execute on function
  public.request_access(uuid, text),
  public.decide_access(uuid, boolean, int),
  public.revoke_access(uuid)
  to authenticated;

-- 4. Replace is_super_admin() with can_view_store_details(supermarket_id) in SELECT policies:

-- A. audit_logs
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated
  using (
    (supermarket_id is null and public.is_super_admin())
    or (supermarket_id is not null and public.can_view_store_details(supermarket_id))
  );

-- B. units, categories, products, product_prices, suppliers
do $$
declare t text;
begin
  foreach t in array array['units','categories','products','product_prices','suppliers'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (
      public.is_store_member(supermarket_id) or public.can_view_store_details(supermarket_id)
    )$p$, t || '_select', t);
  end loop;

  -- purchase_orders, purchase_order_items, stock_receipts, stock_receipt_items
  foreach t in array array['purchase_orders','purchase_order_items','stock_receipts','stock_receipt_items'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (
      public.can_view_store_details(supermarket_id)
      or (public.is_store_member(supermarket_id) and public.has_store_role(supermarket_id, array['admin','stock_staff']::public.app_role[]))
    )$p$, t || '_select', t);
  end loop;

  -- inventory_lots, stock_movements
  foreach t in array array['inventory_lots','stock_movements'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (
      public.can_view_store_details(supermarket_id)
      or public.has_store_role(supermarket_id, array['admin','stock_staff']::public.app_role[])
    )$p$, t || '_select', t);
  end loop;
end $$;

-- C. store_settings, exchange_rates
drop policy if exists settings_select on public.store_settings;
create policy settings_select on public.store_settings for select to authenticated using (
  public.is_store_member(supermarket_id) or public.can_view_store_details(supermarket_id)
);

drop policy if exists rates_select on public.exchange_rates;
create policy rates_select on public.exchange_rates for select to authenticated using (
  public.is_store_member(supermarket_id) or public.can_view_store_details(supermarket_id)
);

-- D. cashier_shifts, cash_movements, sales, sale_items, payments, receipt_print_logs, sale_item_lot_allocations
drop policy if exists shifts_select on public.cashier_shifts;
create policy shifts_select on public.cashier_shifts for select to authenticated using (
  public.can_view_store_details(supermarket_id)
  or (cashier_id = auth.uid() and public.is_store_member(supermarket_id))
);

drop policy if exists cash_mv_select on public.cash_movements;
create policy cash_mv_select on public.cash_movements for select to authenticated using (
  public.can_view_store_details(supermarket_id)
  or (created_by = auth.uid() and public.is_store_member(supermarket_id))
);

drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales for select to authenticated using (
  public.can_view_store_details(supermarket_id)
  or (cashier_id = auth.uid() and public.is_store_member(supermarket_id))
);

drop policy if exists sale_items_select on public.sale_items;
create policy sale_items_select on public.sale_items for select to authenticated using (
  exists (select 1 from public.sales s where s.id = sale_id)
);

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated using (
  exists (select 1 from public.sales s where s.id = sale_id)
);

drop policy if exists print_logs_select on public.receipt_print_logs;
create policy print_logs_select on public.receipt_print_logs for select to authenticated using (
  exists (select 1 from public.sales s where s.id = sale_id)
);

drop policy if exists allocations_select on public.sale_item_lot_allocations;
create policy allocations_select on public.sale_item_lot_allocations for select to authenticated using (
  public.can_view_store_details(supermarket_id)
);

-- E. refunds, refund_items
drop policy if exists refunds_select on public.refunds;
create policy refunds_select on public.refunds for select to authenticated using (
  public.can_view_store_details(supermarket_id)
);

drop policy if exists refund_items_select on public.refund_items;
create policy refund_items_select on public.refund_items for select to authenticated using (
  public.can_view_store_details(supermarket_id)
);

-- F. expenses
drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated using (
  public.can_view_store_details(supermarket_id)
);

-- 5. Update functions: _assert_report_access, get_receipt, get_shift_summary, log_receipt_print

create or replace function public._assert_report_access(p_store uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_view_store_details(p_store) then
    raise exception 'reports are restricted to store admins' using errcode = '42501';
  end if;
end $$;

create or replace function public.get_receipt(p_sale uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.sales;
begin
  select * into s from public.sales where id = p_sale;
  if not found or not (public.can_view_store_details(s.supermarket_id)
          or (s.cashier_id = auth.uid() and public.is_store_member(s.supermarket_id))) then
    raise exception 'receipt not found' using errcode = 'P0002';
  end if;
  return public.build_receipt(p_sale);
end $$;

create or replace function public.log_receipt_print(p_sale uuid, p_reprint boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.sales;
begin
  select * into s from public.sales where id = p_sale;
  if not found or not (public.can_view_store_details(s.supermarket_id)
          or (s.cashier_id = auth.uid() and public.is_store_member(s.supermarket_id))) then
    raise exception 'receipt not found' using errcode = 'P0002';
  end if;
  insert into public.receipt_print_logs (supermarket_id, sale_id, action, requested_by)
  values (s.supermarket_id, p_sale, case when p_reprint then 'reprint_requested' else 'print_requested' end, auth.uid());
end $$;

create or replace function public.get_shift_summary(p_shift uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.cashier_shifts;
begin
  select * into s from public.cashier_shifts where id = p_shift;
  if not found then raise exception 'shift not found' using errcode = 'P0002'; end if;
  if not (public.can_view_store_details(s.supermarket_id)
          or (s.cashier_id = auth.uid() and public.is_store_member(s.supermarket_id))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'shift', jsonb_build_object('id', s.id, 'status', s.status, 'opened_at', s.opened_at, 'closed_at', s.closed_at,
      'opening_usd', s.opening_usd, 'opening_sos', s.opening_sos, 'closing_usd', s.closing_usd, 'closing_sos', s.closing_sos,
      'difference_usd', s.difference_usd, 'difference_sos', s.difference_sos, 'notes', s.notes),
    'sales_count', (select count(*) from public.sales where shift_id = s.id),
    'sales_by_currency', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'count', c, 'total', t))
        from (select currency, count(*) c, sum(total) t from public.sales where shift_id = s.id group by currency) x), '[]'::jsonb),
    'payments_by_method', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'currency', currency, 'amount', a))
        from (select p.method, p.currency, sum(p.amount) a from public.payments p join public.sales sa on sa.id = p.sale_id
              where sa.shift_id = s.id group by 1, 2) y), '[]'::jsonb),
    'expected_usd', public.shift_expected_cash(s.id, 'USD'),
    'expected_sos', public.shift_expected_cash(s.id, 'SOS'));
end $$;
