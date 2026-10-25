-- Phase 7: refunds/voids, expenses, reports. Phase 8: storage policies.

-- p_items: [{sale_item_id, quantity, disposition: 'restock' | 'write_off'}]
create or replace function public._do_refund(p_sale uuid, p_items jsonb, p_reason text, p_method public.payment_method, p_void boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.sales; v_refund uuid; e jsonb; it public.sale_items; v_qty numeric; v_disp public.refund_disposition;
  v_done numeric; v_done_amt numeric; v_amt numeric; v_rem numeric; a record; v_take numeric; v_lot public.inventory_lots;
  v_cost_rev numeric; v_total numeric := 0; v_shift uuid; v_refunded numeric;
  v_lines jsonb := '[]'::jsonb;
begin
  select * into s from public.sales where id = p_sale for update;
  if not found then raise exception 'sale not found' using errcode = 'P0002'; end if;
  if not public.has_store_role(s.supermarket_id, array['admin']::public.app_role[]) then
    raise exception 'only a store admin can approve refunds' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if s.status in ('refunded', 'voided') then raise exception 'sale is already fully refunded' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'select items to refund' using errcode = '22023'; end if;
  select id into v_shift from public.cashier_shifts where id = s.shift_id and status = 'open';

  -- pass 1: validate quantities and compute amounts
  for e in select * from jsonb_array_elements(p_items) loop
    select * into it from public.sale_items where id = (e ->> 'sale_item_id')::uuid and sale_id = s.id for update;
    if not found then raise exception 'item does not belong to this sale' using errcode = '22023'; end if;
    v_qty := (e ->> 'quantity')::numeric; v_disp := coalesce(e ->> 'disposition', 'write_off')::public.refund_disposition;
    if v_qty is null or v_qty <= 0 or v_qty <> round(v_qty, 3) then raise exception 'invalid refund quantity' using errcode = '22023'; end if;
    select coalesce(sum(quantity), 0), coalesce(sum(amount), 0) into v_done, v_done_amt from public.refund_items where sale_item_id = it.id;
    if v_qty > it.quantity - v_done then raise exception 'cannot refund % of %: only % remaining', v_qty, it.product_name, it.quantity - v_done using errcode = '22023'; end if;
    v_amt := case when v_qty = it.quantity - v_done then it.line_total - v_done_amt
                  else public.round_money(it.line_total * v_qty / it.quantity, s.currency) end;
    v_lines := v_lines || jsonb_build_object('item', it.id, 'qty', v_qty, 'amount', v_amt, 'disp', v_disp);
    v_total := v_total + v_amt;
  end loop;
  select coalesce(sum(total_amount), 0) into v_refunded from public.refunds where sale_id = s.id;
  if v_total <= 0 then raise exception 'nothing to refund' using errcode = '22023'; end if;
  if v_refunded + v_total > s.total then raise exception 'refund exceeds the original sale amount' using errcode = '22023'; end if;

  insert into public.refunds (supermarket_id, sale_id, shift_id, refund_method, currency, total_amount, reason, is_void, created_by, approved_by)
  values (s.supermarket_id, s.id, v_shift, p_method, s.currency, v_total, btrim(p_reason), p_void, auth.uid(), auth.uid()) returning id into v_refund;

  -- pass 2: write items and move stock
  for e in select * from jsonb_array_elements(v_lines) loop
    v_qty := (e ->> 'qty')::numeric; v_disp := (e ->> 'disp')::public.refund_disposition; v_cost_rev := 0;
    if v_disp = 'restock' then
      v_rem := v_qty;
      for a in select al.* from public.sale_item_lot_allocations al join public.inventory_lots lt on lt.id = al.lot_id
               where al.sale_item_id = (e ->> 'item')::uuid and al.returned_quantity < al.quantity order by lt.seq desc loop
        exit when v_rem <= 0;
        v_take := least(v_rem, a.quantity - a.returned_quantity);
        select * into v_lot from public.inventory_lots where id = a.lot_id for update;
        -- expired goods are never put back on the shelf
        if v_lot.expiry_date is not null and v_lot.expiry_date < public.store_today() then continue; end if;
        update public.inventory_lots set quantity_remaining = quantity_remaining + v_take where id = v_lot.id;
        update public.sale_item_lot_allocations set returned_quantity = returned_quantity + v_take where id = a.id;
        insert into public.stock_movements (supermarket_id, product_id, lot_id, movement_type, quantity, reference_type, reference_id, reason, created_by)
        values (s.supermarket_id, v_lot.product_id, v_lot.id, 'refund_return', v_take, 'refund', v_refund, btrim(p_reason), auth.uid());
        v_cost_rev := v_cost_rev + round(a.cost_in_sale_currency * v_take / a.quantity, 4);
        v_rem := v_rem - v_take;
      end loop;
      -- anything that could not be restocked (expired lot) is a write-off, recorded in the refund item
      if v_rem > 0 then v_disp := 'write_off'; end if;
    end if;
    insert into public.refund_items (supermarket_id, refund_id, sale_item_id, quantity, amount, disposition, cost_reversed)
    values (s.supermarket_id, v_refund, (e ->> 'item')::uuid, v_qty, (e ->> 'amount')::numeric, v_disp, v_cost_rev);
  end loop;

  update public.sales set status = case when p_void then 'voided' when v_refunded + v_total = s.total then 'refunded' else 'partially_refunded' end::public.sale_status
   where id = s.id;
  perform public.write_audit(s.supermarket_id, case when p_void then 'sale.voided' else 'sale.refunded' end, 'refund', v_refund,
    jsonb_build_object('sale', s.id, 'amount', v_total, 'reason', p_reason, 'method', p_method));
  return v_refund;
end $$;

create or replace function public.refund_sale(p_sale uuid, p_items jsonb, p_reason text, p_method public.payment_method)
returns uuid language sql security definer set search_path = '' as $$
  select public._do_refund(p_sale, p_items, p_reason, p_method, false);
$$;

-- Void = refund of every item (restocked), only for a sale with no earlier refunds.
create or replace function public.void_sale(p_sale uuid, p_reason text, p_method public.payment_method)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.sales;
begin
  select * into s from public.sales where id = p_sale;
  if not found then raise exception 'sale not found' using errcode = 'P0002'; end if;
  if s.status <> 'completed' then raise exception 'only an untouched sale can be voided' using errcode = '22023'; end if;
  return public._do_refund(p_sale,
    (select jsonb_agg(jsonb_build_object('sale_item_id', i.id, 'quantity', i.quantity, 'disposition', 'restock')) from public.sale_items i where i.sale_id = p_sale),
    p_reason, p_method, true);
end $$;

-- ---------------------------------------------------------------- expenses
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  category text not null check (char_length(btrim(category)) > 0),
  description text not null check (char_length(btrim(description)) > 0),
  amount numeric(14, 2) not null check (amount > 0),
  currency public.currency not null,
  expense_date date not null default current_date,
  status text not null default 'recorded' check (status in ('recorded', 'cancelled')),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index expenses_store_date_idx on public.expenses (supermarket_id, expense_date desc);
create trigger expenses_audit after insert or update on public.expenses for each row execute function public.audit_row_change();
alter table public.expenses enable row level security;
create policy expenses_select on public.expenses for select to authenticated using (
  public.is_super_admin() or public.has_store_role(supermarket_id, array['admin']::public.app_role[]));
create policy expenses_insert on public.expenses for insert to authenticated with check (
  public.has_store_role(supermarket_id, array['admin']::public.app_role[]) and created_by = auth.uid());
create policy expenses_update on public.expenses for update to authenticated
  using (public.has_store_role(supermarket_id, array['admin']::public.app_role[]))
  with check (public.has_store_role(supermarket_id, array['admin']::public.app_role[]));
grant select, insert on public.expenses to authenticated;
grant update (status) on public.expenses to authenticated;

-- ----------------------------------------------------------------- reports
create or replace function public._assert_report_access(p_store uuid) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_super_admin() or public.has_store_role(p_store, array['admin']::public.app_role[])) then
    raise exception 'reports are restricted to store admins' using errcode = '42501';
  end if;
end $$;

create or replace function public.report_sales_by_period(p_store uuid, p_from date, p_to date, p_grain text default 'day')
returns table (period date, currency public.currency, sales_count bigint, subtotal numeric, discounts numeric, net_sales numeric, refunds numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._assert_report_access(p_store);
  if p_grain not in ('day', 'week', 'month') then raise exception 'bad grain' using errcode = '22023'; end if;
  return query
  with s as (
    select date_trunc(p_grain, x.created_at at time zone 'Africa/Mogadishu')::date as period, x.currency, count(*) as c,
           sum(x.subtotal) as sub, sum(x.discount_total) as disc, sum(x.total) as tot
    from public.sales x where x.supermarket_id = p_store
      and (x.created_at at time zone 'Africa/Mogadishu')::date between p_from and p_to group by 1, 2),
  r as (
    select date_trunc(p_grain, x.created_at at time zone 'Africa/Mogadishu')::date as period, x.currency, sum(x.total_amount) as ref
    from public.refunds x where x.supermarket_id = p_store
      and (x.created_at at time zone 'Africa/Mogadishu')::date between p_from and p_to group by 1, 2)
  select coalesce(s.period, r.period), coalesce(s.currency, r.currency), coalesce(s.c, 0), coalesce(s.sub, 0), coalesce(s.disc, 0),
         coalesce(s.tot, 0) - coalesce(r.ref, 0), coalesce(r.ref, 0)
  from s full join r on s.period = r.period and s.currency = r.currency order by 1, 2;
end $$;

-- p_dim: product | category | cashier | payment_method
create or replace function public.report_sales_breakdown(p_store uuid, p_from date, p_to date, p_dim text)
returns table (label text, currency public.currency, quantity numeric, amount numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._assert_report_access(p_store);
  if p_dim = 'product' then
    return query select i.product_name, s.currency, sum(i.quantity), sum(i.line_total) from public.sale_items i join public.sales s on s.id = i.sale_id
      where s.supermarket_id = p_store and (s.created_at at time zone 'Africa/Mogadishu')::date between p_from and p_to group by 1, 2 order by 4 desc;
  elsif p_dim = 'category' then
    return query select coalesce(c.name, 'Uncategorised'), s.currency, sum(i.quantity), sum(i.line_total) from public.sale_items i
      join public.sales s on s.id = i.sale_id join public.products p on p.id = i.product_id left join public.categories c on c.id = p.category_id
      where s.supermarket_id = p_store and (s.created_at at time zone 'Africa/Mogadishu')::date between p_from and p_to group by 1, 2 order by 4 desc;
  elsif p_dim = 'cashier' then
    return query select pr.full_name, s.currency, count(*)::numeric, sum(s.total) from public.sales s join public.profiles pr on pr.id = s.cashier_id
      where s.supermarket_id = p_store and (s.created_at at time zone 'Africa/Mogadishu')::date between p_from and p_to group by 1, 2 order by 4 desc;
  elsif p_dim = 'payment_method' then
    return query select pm.method::text, s.currency, count(*)::numeric, sum(pm.converted_amount) from public.payments pm join public.sales s on s.id = pm.sale_id
      where s.supermarket_id = p_store and (s.created_at at time zone 'Africa/Mogadishu')::date between p_from and p_to group by 1, 2 order by 4 desc;
  else raise exception 'unknown dimension' using errcode = '22023'; end if;
end $$;

-- Gross profit = net sales (after discounts, minus refunds) - FIFO cost of goods sold (minus cost of restocked refunds).
-- Operating result = gross profit - recorded (non-cancelled) expenses. It is an estimate, not formal net profit.
-- Each currency is reported separately; FIFO cost of lots bought in another currency is converted at the rate in force at sale time.
create or replace function public.report_profit(p_store uuid, p_from date, p_to date)
returns table (currency public.currency, net_sales numeric, discounts numeric, refunds numeric, cogs numeric, gross_profit numeric, expenses numeric, operating_result numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._assert_report_access(p_store);
  return query
  with sales_p as (
    select s.currency, sum(s.total) as tot, sum(s.discount_total) as disc,
           coalesce(sum((select sum(i.cost_total) from public.sale_items i where i.sale_id = s.id)), 0) as cost
    from public.sales s where s.supermarket_id = p_store and (s.created_at at time zone 'Africa/Mogadishu')::date between p_from and p_to group by 1),
  refunds_p as (
    select r.currency, sum(r.total_amount) as ref, coalesce(sum((select sum(ri.cost_reversed) from public.refund_items ri where ri.refund_id = r.id)), 0) as costrev
    from public.refunds r where r.supermarket_id = p_store and (r.created_at at time zone 'Africa/Mogadishu')::date between p_from and p_to group by 1),
  exp_p as (
    select e.currency, sum(e.amount) as amt from public.expenses e
    where e.supermarket_id = p_store and e.status = 'recorded' and e.expense_date between p_from and p_to group by 1),
  cur as (select unnest(enum_range(null::public.currency)) as currency)
  select cur.currency,
    coalesce(sp.tot, 0) - coalesce(rp.ref, 0), coalesce(sp.disc, 0), coalesce(rp.ref, 0),
    coalesce(sp.cost, 0) - coalesce(rp.costrev, 0),
    coalesce(sp.tot, 0) - coalesce(rp.ref, 0) - (coalesce(sp.cost, 0) - coalesce(rp.costrev, 0)),
    coalesce(ep.amt, 0),
    coalesce(sp.tot, 0) - coalesce(rp.ref, 0) - (coalesce(sp.cost, 0) - coalesce(rp.costrev, 0)) - coalesce(ep.amt, 0)
  from cur left join sales_p sp on sp.currency = cur.currency left join refunds_p rp on rp.currency = cur.currency
       left join exp_p ep on ep.currency = cur.currency;
end $$;

create or replace function public.platform_summary()
returns table (store_id uuid, store_name text, is_active boolean, currency public.currency, sales_count bigint, total numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  return query
  select sm.id, sm.name, sm.is_active, s.currency, count(s.id), coalesce(sum(s.total), 0)
  from public.supermarkets sm left join public.sales s on s.supermarket_id = sm.id and s.created_at >= now() - interval '30 days'
  group by sm.id, sm.name, sm.is_active, s.currency order by sm.name;
end $$;

-- --------------------------------------------------------- storage (images)
do $$
begin
  if to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public) values ('product-images', 'product-images', true) on conflict (id) do nothing;
    execute $p$create policy product_images_admin_write on storage.objects for insert to authenticated
      with check (bucket_id = 'product-images' and public.has_store_role(((storage.foldername(name))[1])::uuid, array['admin']::public.app_role[]))$p$;
    execute $p$create policy product_images_admin_update on storage.objects for update to authenticated
      using (bucket_id = 'product-images' and public.has_store_role(((storage.foldername(name))[1])::uuid, array['admin']::public.app_role[]))$p$;
    execute $p$create policy product_images_admin_delete on storage.objects for delete to authenticated
      using (bucket_id = 'product-images' and public.has_store_role(((storage.foldername(name))[1])::uuid, array['admin']::public.app_role[]))$p$;
  end if;
end $$;

revoke execute on all functions in schema public from public, anon;
revoke execute on function public._do_refund(uuid, jsonb, text, public.payment_method, boolean) from authenticated;
revoke execute on function public._assert_report_access(uuid) from authenticated;
grant execute on function
  public.refund_sale(uuid, jsonb, text, public.payment_method), public.void_sale(uuid, text, public.payment_method),
  public.report_sales_by_period(uuid, date, date, text), public.report_sales_breakdown(uuid, date, date, text),
  public.report_profit(uuid, date, date), public.platform_summary()
  to authenticated;
