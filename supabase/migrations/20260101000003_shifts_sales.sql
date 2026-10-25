-- Phases 5-6: cashier shifts, transaction-safe checkout, FIFO allocation, payments, receipts.

create type public.payment_method as enum ('cash', 'evc_plus', 'sahal', 'zaad');
create type public.sale_status as enum ('completed', 'partially_refunded', 'refunded', 'voided');
create type public.shift_status as enum ('open', 'closed');

create table public.cashier_shifts (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  cashier_id uuid not null references public.profiles (id),
  status public.shift_status not null default 'open',
  opening_usd numeric(14, 2) not null default 0 check (opening_usd >= 0),
  opening_sos numeric(14, 0) not null default 0 check (opening_sos >= 0),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closing_usd numeric(14, 2), closing_sos numeric(14, 0),
  expected_usd numeric(14, 2), expected_sos numeric(14, 0),
  difference_usd numeric(14, 2), difference_sos numeric(14, 0),
  notes text,
  unique (id, supermarket_id)
);
create unique index one_open_shift_per_cashier on public.cashier_shifts (supermarket_id, cashier_id) where status = 'open';

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  shift_id uuid not null, kind text not null check (kind in ('cash_in', 'cash_out')),
  currency public.currency not null, amount numeric(14, 2) not null check (amount > 0),
  reason text not null check (char_length(btrim(reason)) >= 3),
  created_by uuid references public.profiles (id), created_at timestamptz not null default now(),
  foreign key (shift_id, supermarket_id) references public.cashier_shifts (id, supermarket_id)
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  shift_id uuid not null, cashier_id uuid not null references public.profiles (id),
  receipt_number text not null,
  idempotency_key text not null,
  currency public.currency not null,
  subtotal numeric(14, 2) not null, discount_total numeric(14, 2) not null, total numeric(14, 2) not null,
  status public.sale_status not null default 'completed',
  created_at timestamptz not null default now(),
  unique (id, supermarket_id), unique (supermarket_id, receipt_number),
  unique (supermarket_id, cashier_id, idempotency_key),
  check (total = subtotal - discount_total and total >= 0),
  foreign key (shift_id, supermarket_id) references public.cashier_shifts (id, supermarket_id)
);
create index sales_store_date_idx on public.sales (supermarket_id, created_at desc);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  sale_id uuid not null, product_id uuid not null,
  product_name text not null, sku text, barcode text,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price numeric(14, 2) not null, line_subtotal numeric(14, 2) not null,
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  discount_amount numeric(14, 2) not null default 0, line_total numeric(14, 2) not null,
  cost_total numeric(18, 4) not null default 0,   -- FIFO cost in the sale currency
  created_at timestamptz not null default now(),
  unique (id, supermarket_id),
  check (line_total = line_subtotal - discount_amount),
  foreign key (sale_id, supermarket_id) references public.sales (id, supermarket_id),
  foreign key (product_id, supermarket_id) references public.products (id, supermarket_id)
);
create index sale_items_sale_idx on public.sale_items (sale_id);

create table public.sale_item_lot_allocations (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  sale_item_id uuid not null, lot_id uuid not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  returned_quantity numeric(14, 3) not null default 0 check (returned_quantity >= 0 and returned_quantity <= quantity),
  unit_cost numeric(14, 4) not null, cost_currency public.currency not null,
  cost_amount numeric(18, 4) not null,
  cost_in_sale_currency numeric(18, 4) not null,
  created_at timestamptz not null default now(),
  foreign key (sale_item_id, supermarket_id) references public.sale_items (id, supermarket_id),
  foreign key (lot_id, supermarket_id) references public.inventory_lots (id, supermarket_id)
);
create index allocations_item_idx on public.sale_item_lot_allocations (sale_item_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  sale_id uuid not null,
  method public.payment_method not null,
  amount numeric(14, 2) not null check (amount > 0),
  currency public.currency not null,
  exchange_rate numeric(14, 4),                       -- SOS per 1 USD, only when currencies differ
  converted_amount numeric(14, 2) not null check (converted_amount > 0),  -- in the sale currency
  reference text,
  verification text not null default 'manual' check (verification in ('manual', 'provider_verified')),
  cashier_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  foreign key (sale_id, supermarket_id) references public.sales (id, supermarket_id)
);
create index payments_sale_idx on public.payments (sale_id);

create table public.receipt_print_logs (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  sale_id uuid not null, action text not null check (action in ('print_requested', 'reprint_requested')),
  requested_by uuid references public.profiles (id), created_at timestamptz not null default now(),
  foreign key (sale_id, supermarket_id) references public.sales (id, supermarket_id)
);

-- Ledger-like tables: no updates/deletes of the financial snapshot rows.
create trigger payments_immutable before update or delete on public.payments for each row execute function public.forbid_change();
create or replace function public.sale_items_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  -- Only the one-time cost fill-in during checkout is allowed; everything else is immutable.
  if tg_op = 'DELETE' or old.cost_total <> 0 or (to_jsonb(new) - 'cost_total') <> (to_jsonb(old) - 'cost_total') then
    raise exception '% on sale_items is not allowed: historical snapshot', tg_op using errcode = '42501';
  end if;
  return new;
end $$;
create trigger sale_items_guard before update or delete on public.sale_items for each row execute function public.sale_items_guard();
create trigger print_logs_immutable before update or delete on public.receipt_print_logs for each row execute function public.forbid_change();

-- RLS: reads only; admin/super see everything, cashiers see their own sales.
alter table public.cashier_shifts enable row level security;
alter table public.cash_movements enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_item_lot_allocations enable row level security;
alter table public.payments enable row level security;
alter table public.receipt_print_logs enable row level security;

create policy shifts_select on public.cashier_shifts for select to authenticated using (
  public.is_super_admin() or public.has_store_role(supermarket_id, array['admin']::public.app_role[])
  or (cashier_id = auth.uid() and public.is_store_member(supermarket_id)));
create policy cash_mv_select on public.cash_movements for select to authenticated using (
  public.is_super_admin() or public.has_store_role(supermarket_id, array['admin']::public.app_role[])
  or (created_by = auth.uid() and public.is_store_member(supermarket_id)));
create policy sales_select on public.sales for select to authenticated using (
  public.is_super_admin() or public.has_store_role(supermarket_id, array['admin']::public.app_role[])
  or (cashier_id = auth.uid() and public.is_store_member(supermarket_id)));
create policy sale_items_select on public.sale_items for select to authenticated using (
  exists (select 1 from public.sales s where s.id = sale_id));
create policy payments_select on public.payments for select to authenticated using (
  exists (select 1 from public.sales s where s.id = sale_id));
create policy print_logs_select on public.receipt_print_logs for select to authenticated using (
  exists (select 1 from public.sales s where s.id = sale_id));
create policy allocations_select on public.sale_item_lot_allocations for select to authenticated using (
  public.is_super_admin() or public.has_store_role(supermarket_id, array['admin']::public.app_role[]));

-- Cashiers must not read FIFO costs, so expose sale_items without cost via a view.
revoke all on public.sale_items from authenticated;
create view public.sale_items_public with (security_invoker = true) as
select id, supermarket_id, sale_id, product_id, product_name, sku, barcode, quantity, unit_price, line_subtotal,
       discount_pct, discount_amount, line_total, created_at from public.sale_items;
grant select on public.cashier_shifts, public.cash_movements, public.sales, public.payments,
  public.receipt_print_logs, public.sale_item_lot_allocations to authenticated;
grant select on public.sale_items_public to authenticated;
-- security_invoker views need base-table access for the invoking role; grant column-level select (no cost).
grant select (id, supermarket_id, sale_id, product_id, product_name, sku, barcode, quantity, unit_price, line_subtotal,
              discount_pct, discount_amount, line_total, created_at) on public.sale_items to authenticated;
-- admins additionally read cost through the allocations table; sale_items.cost_total is not granted.


create type public.refund_disposition as enum ('restock', 'write_off');
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  sale_id uuid not null, shift_id uuid,
  refund_method public.payment_method not null,
  currency public.currency not null,
  total_amount numeric(14, 2) not null check (total_amount > 0),
  reason text not null check (char_length(btrim(reason)) >= 3),
  is_void boolean not null default false,
  created_by uuid not null references public.profiles (id),
  approved_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (id, supermarket_id),
  foreign key (sale_id, supermarket_id) references public.sales (id, supermarket_id),
  foreign key (shift_id, supermarket_id) references public.cashier_shifts (id, supermarket_id)
);
create table public.refund_items (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  refund_id uuid not null, sale_item_id uuid not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  amount numeric(14, 2) not null check (amount >= 0),
  disposition public.refund_disposition not null,
  cost_reversed numeric(18, 4) not null default 0,
  foreign key (refund_id, supermarket_id) references public.refunds (id, supermarket_id),
  foreign key (sale_item_id, supermarket_id) references public.sale_items (id, supermarket_id)
);
create trigger refunds_immutable before update or delete on public.refunds for each row execute function public.forbid_change();
create trigger refund_items_immutable before update or delete on public.refund_items for each row execute function public.forbid_change();
alter table public.refunds enable row level security;
alter table public.refund_items enable row level security;
create policy refunds_select on public.refunds for select to authenticated using (
  public.is_super_admin() or public.has_store_role(supermarket_id, array['admin']::public.app_role[]));
create policy refund_items_select on public.refund_items for select to authenticated using (
  public.is_super_admin() or public.has_store_role(supermarket_id, array['admin']::public.app_role[]));
grant select on public.refunds, public.refund_items to authenticated;

-- ------------------------------------------------------------------ shifts
create or replace function public.shift_expected_cash(p_shift uuid, p_currency public.currency) returns numeric
language sql stable security definer set search_path = '' as $$
  select (case when p_currency = 'USD' then s.opening_usd else s.opening_sos end)
    + coalesce((select sum(p.amount) from public.payments p join public.sales sa on sa.id = p.sale_id
                where sa.shift_id = s.id and p.method = 'cash' and p.currency = p_currency), 0)
    + coalesce((select sum(m.amount) from public.cash_movements m where m.shift_id = s.id and m.currency = p_currency and m.kind = 'cash_in'), 0)
    - coalesce((select sum(m.amount) from public.cash_movements m where m.shift_id = s.id and m.currency = p_currency and m.kind = 'cash_out'), 0)
    - coalesce((select sum(r.total_amount) from public.refunds r where r.shift_id = s.id and r.refund_method = 'cash' and r.currency = p_currency), 0)
  from public.cashier_shifts s where s.id = p_shift;
$$;

create or replace function public.open_shift(p_store uuid, p_opening_usd numeric, p_opening_sos numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.has_store_role(p_store, array['cashier']::public.app_role[]) then
    raise exception 'only cashiers can open a shift' using errcode = '42501';
  end if;
  if coalesce(p_opening_usd, 0) < 0 or coalesce(p_opening_sos, 0) < 0 then raise exception 'opening cash cannot be negative' using errcode = '22023'; end if;
  insert into public.cashier_shifts (supermarket_id, cashier_id, opening_usd, opening_sos)
  values (p_store, auth.uid(), round(coalesce(p_opening_usd, 0), 2), round(coalesce(p_opening_sos, 0), 0)) returning id into v_id;
  perform public.write_audit(p_store, 'shift.opened', 'cashier_shift', v_id, '{}'::jsonb);
  return v_id;
exception when unique_violation then
  raise exception 'you already have an open shift' using errcode = '22023';
end $$;

create or replace function public.record_cash_movement(p_shift uuid, p_kind text, p_currency public.currency, p_amount numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.cashier_shifts; v_id uuid;
begin
  select * into s from public.cashier_shifts where id = p_shift for update;
  if not found then raise exception 'shift not found' using errcode = 'P0002'; end if;
  if s.status <> 'open' then raise exception 'shift is closed' using errcode = '22023'; end if;
  if not (s.cashier_id = auth.uid() and public.has_store_role(s.supermarket_id, array['cashier']::public.app_role[])) then
    raise exception 'only the shift cashier can record cash movements' using errcode = '42501';
  end if;
  insert into public.cash_movements (supermarket_id, shift_id, kind, currency, amount, reason, created_by)
  values (s.supermarket_id, p_shift, p_kind, p_currency, public.round_money(p_amount, p_currency), p_reason, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.close_shift(p_shift uuid, p_closing_usd numeric, p_closing_sos numeric, p_notes text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.cashier_shifts; eu numeric; es numeric;
begin
  select * into s from public.cashier_shifts where id = p_shift for update;
  if not found then raise exception 'shift not found' using errcode = 'P0002'; end if;
  if s.cashier_id <> auth.uid() or not public.is_store_member(s.supermarket_id) then
    raise exception 'only the shift cashier can close it' using errcode = '42501';
  end if;
  if s.status <> 'open' then raise exception 'shift is already closed' using errcode = '22023'; end if;
  if coalesce(p_closing_usd, 0) < 0 or coalesce(p_closing_sos, 0) < 0 then raise exception 'closing cash cannot be negative' using errcode = '22023'; end if;
  eu := public.shift_expected_cash(p_shift, 'USD'); es := public.shift_expected_cash(p_shift, 'SOS');
  update public.cashier_shifts set status = 'closed', closed_at = now(),
    closing_usd = round(coalesce(p_closing_usd, 0), 2), closing_sos = round(coalesce(p_closing_sos, 0), 0),
    expected_usd = eu, expected_sos = es,
    difference_usd = round(coalesce(p_closing_usd, 0), 2) - eu, difference_sos = round(coalesce(p_closing_sos, 0), 0) - es,
    notes = nullif(btrim(p_notes), '')
  where id = p_shift;
  perform public.write_audit(s.supermarket_id, 'shift.closed', 'cashier_shift', p_shift,
    jsonb_build_object('diff_usd', round(coalesce(p_closing_usd, 0), 2) - eu, 'diff_sos', round(coalesce(p_closing_sos, 0), 0) - es));
  return public.get_shift_summary(p_shift);
end $$;

create or replace function public.get_shift_summary(p_shift uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.cashier_shifts;
begin
  select * into s from public.cashier_shifts where id = p_shift;
  if not found then raise exception 'shift not found' using errcode = 'P0002'; end if;
  if not (public.is_super_admin() or public.has_store_role(s.supermarket_id, array['admin']::public.app_role[])
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

-- Receipt payload (no cost data). Internal; callers must be authorised first.
create or replace function public.build_receipt(p_sale uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'sale', jsonb_build_object('id', s.id, 'receipt_number', s.receipt_number, 'currency', s.currency, 'subtotal', s.subtotal,
        'discount_total', s.discount_total, 'total', s.total, 'status', s.status, 'created_at', s.created_at),
    'store', jsonb_build_object('name', sm.name, 'phone', sm.phone, 'email', sm.email, 'address', sm.address, 'footer', st.receipt_footer),
    'cashier', pr.full_name,
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.product_name, 'quantity', i.quantity, 'unit_price', i.unit_price,
        'discount_pct', i.discount_pct, 'discount_amount', i.discount_amount, 'line_total', i.line_total) order by i.created_at, i.id)
        from public.sale_items i where i.sale_id = s.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('method', p.method, 'amount', p.amount, 'currency', p.currency,
        'exchange_rate', p.exchange_rate, 'converted_amount', p.converted_amount, 'reference', p.reference,
        'verification', p.verification) order by p.created_at, p.id) from public.payments p where p.sale_id = s.id), '[]'::jsonb),
    'print_count', (select count(*) from public.receipt_print_logs l where l.sale_id = s.id))
  from public.sales s
  join public.supermarkets sm on sm.id = s.supermarket_id
  join public.store_settings st on st.supermarket_id = s.supermarket_id
  join public.profiles pr on pr.id = s.cashier_id
  where s.id = p_sale;
$$;

create or replace function public.get_receipt(p_sale uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.sales;
begin
  select * into s from public.sales where id = p_sale;
  if not found or not (public.is_super_admin() or public.has_store_role(s.supermarket_id, array['admin']::public.app_role[])
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
  if not found or not (public.is_super_admin() or public.has_store_role(s.supermarket_id, array['admin']::public.app_role[])
          or (s.cashier_id = auth.uid() and public.is_store_member(s.supermarket_id))) then
    raise exception 'receipt not found' using errcode = 'P0002';
  end if;
  insert into public.receipt_print_logs (supermarket_id, sale_id, action, requested_by)
  values (s.supermarket_id, p_sale, case when p_reprint then 'reprint_requested' else 'print_requested' end, auth.uid());
end $$;

-- ---------------------------------------------------------------- checkout
-- The client sends only product ids, quantities, discount percentages and payment claims.
-- Prices, costs, totals and stock are all decided here.
create or replace function public.checkout(
  p_store uuid, p_shift uuid, p_currency public.currency, p_items jsonb, p_payments jsonb, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_member public.supermarket_members;
  v_shift public.cashier_shifts;
  v_existing uuid; v_rate numeric; v_sale uuid; v_item uuid;
  r record; v_prod public.products; v_price numeric; v_sub numeric; v_disc numeric; v_line numeric;
  v_remaining numeric; v_take numeric; v_lot record; v_cost numeric; v_alloc_sc numeric;
  v_subtotal numeric := 0; v_discount numeric := 0; v_total numeric := 0; v_paid numeric := 0;
  pay record; v_conv numeric; v_n bigint; v_receipt text; v_pay_rate numeric;
begin
  if v_uid is null or not public.has_store_role(p_store, array['cashier']::public.app_role[]) then
    raise exception 'only cashiers can complete sales' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(btrim(p_idempotency_key)) < 8 then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_store::text || v_uid::text || p_idempotency_key));
  select id into v_existing from public.sales where supermarket_id = p_store and cashier_id = v_uid and idempotency_key = p_idempotency_key;
  if found then return public.build_receipt(v_existing); end if;

  select * into v_member from public.supermarket_members where supermarket_id = p_store and user_id = v_uid and is_active;
  select * into v_shift from public.cashier_shifts where id = p_shift and supermarket_id = p_store for share;
  if not found or v_shift.cashier_id <> v_uid then raise exception 'shift not found' using errcode = 'P0002'; end if;
  if v_shift.status <> 'open' then raise exception 'your shift is closed; open a new shift to sell' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'cart is empty' using errcode = '22023'; end if;
  if jsonb_typeof(p_payments) is distinct from 'array' or jsonb_array_length(p_payments) = 0 then raise exception 'add a payment' using errcode = '22023'; end if;
  v_rate := public.store_rate(p_store);

  v_receipt := null;
  insert into public.store_counters (supermarket_id, name, value) values (p_store, 'receipt', 1)
    on conflict (supermarket_id, name) do update set value = public.store_counters.value + 1 returning value into v_n;
  v_receipt := 'R-' || to_char(now() at time zone 'Africa/Mogadishu', 'YYMMDD') || '-' || lpad(v_n::text, 6, '0');

  insert into public.sales (supermarket_id, shift_id, cashier_id, receipt_number, idempotency_key, currency, subtotal, discount_total, total)
  values (p_store, p_shift, v_uid, v_receipt, p_idempotency_key, p_currency, 0, 0, 0)  -- totals set below
  returning id into v_sale;

  for r in
    select (e ->> 'product_id')::uuid as product_id, sum((e ->> 'quantity')::numeric) as quantity,
           max(coalesce((e ->> 'discount_pct')::numeric, 0)) as discount_pct
    from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    if r.quantity is null or r.quantity <= 0 or r.quantity <> round(r.quantity, 3) then raise exception 'invalid quantity' using errcode = '22023'; end if;
    if r.discount_pct < 0 or r.discount_pct > v_member.cashier_max_discount_pct then
      raise exception 'discount exceeds your limit of % percent', v_member.cashier_max_discount_pct using errcode = '22023';
    end if;
    select * into v_prod from public.products where id = r.product_id and supermarket_id = p_store and is_active;
    if not found then raise exception 'a product in the cart is unavailable' using errcode = 'P0002'; end if;
    select price into v_price from public.product_prices where product_id = v_prod.id and currency = p_currency;
    if v_price is null then raise exception '% has no % price', v_prod.name, p_currency using errcode = '22023'; end if;
    v_sub := public.round_money(r.quantity * v_price, p_currency);
    v_disc := public.round_money(v_sub * r.discount_pct / 100, p_currency);
    v_line := v_sub - v_disc;
    insert into public.sale_items (supermarket_id, sale_id, product_id, product_name, sku, barcode, quantity, unit_price, line_subtotal, discount_pct, discount_amount, line_total)
    values (p_store, v_sale, v_prod.id, v_prod.name, v_prod.sku, v_prod.barcode, r.quantity, v_price, v_sub, r.discount_pct, v_disc, v_line) returning id into v_item;

    -- FIFO: oldest non-expired lots first, rows locked until commit so concurrent sales cannot oversell.
    v_remaining := r.quantity; v_cost := 0;
    for v_lot in
      select id, quantity_remaining, unit_cost, cost_currency from public.inventory_lots
      where supermarket_id = p_store and product_id = v_prod.id and quantity_remaining > 0
        and (expiry_date is null or expiry_date >= public.store_today())
      order by received_at, seq for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_lot.quantity_remaining);
      if v_lot.cost_currency = p_currency then v_alloc_sc := v_take * v_lot.unit_cost;
      elsif v_rate is null then raise exception 'set an exchange rate before selling stock costed in another currency' using errcode = '22023';
      elsif v_lot.cost_currency = 'USD' then v_alloc_sc := v_take * v_lot.unit_cost * v_rate;
      else v_alloc_sc := v_take * v_lot.unit_cost / v_rate; end if;
      insert into public.sale_item_lot_allocations (supermarket_id, sale_item_id, lot_id, quantity, unit_cost, cost_currency, cost_amount, cost_in_sale_currency)
      values (p_store, v_item, v_lot.id, v_take, v_lot.unit_cost, v_lot.cost_currency, round(v_take * v_lot.unit_cost, 4), round(v_alloc_sc, 4));
      update public.inventory_lots set quantity_remaining = quantity_remaining - v_take where id = v_lot.id;
      insert into public.stock_movements (supermarket_id, product_id, lot_id, movement_type, quantity, reference_type, reference_id, created_by)
      values (p_store, v_prod.id, v_lot.id, 'sale', -v_take, 'sale', v_sale, v_uid);
      v_remaining := v_remaining - v_take; v_cost := v_cost + round(v_alloc_sc, 4);
    end loop;
    if v_remaining > 0 then raise exception 'not enough stock for %', v_prod.name using errcode = '22023'; end if;
    update public.sale_items set cost_total = v_cost where id = v_item;  -- allowed: trigger blocks only via client path below
    v_subtotal := v_subtotal + v_sub; v_discount := v_discount + v_disc; v_total := v_total + v_line;
  end loop;

  if v_total <= 0 then raise exception 'sale total must be greater than zero' using errcode = '22023'; end if;

  for pay in
    select (e ->> 'method')::public.payment_method as method, (e ->> 'amount')::numeric as amount,
           (e ->> 'currency')::public.currency as currency, nullif(btrim(e ->> 'reference'), '') as reference
    from jsonb_array_elements(p_payments) e
  loop
    if pay.amount is null or pay.amount <= 0 or pay.amount <> public.round_money(pay.amount, pay.currency) then
      raise exception 'invalid payment amount' using errcode = '22023';
    end if;
    v_pay_rate := null;
    if pay.currency = p_currency then v_conv := pay.amount;
    else
      if v_rate is null then raise exception 'no exchange rate is set for this store' using errcode = '22023'; end if;
      v_pay_rate := v_rate;
      v_conv := case when pay.currency = 'USD' then pay.amount * v_rate else pay.amount / v_rate end;
    end if;
    v_conv := public.round_money(v_conv, p_currency);
    if v_conv <= 0 then raise exception 'payment amount too small' using errcode = '22023'; end if;
    insert into public.payments (supermarket_id, sale_id, method, amount, currency, exchange_rate, converted_amount, reference, cashier_id)
    values (p_store, v_sale, pay.method, pay.amount, pay.currency, v_pay_rate, v_conv, pay.reference, v_uid);
    v_paid := v_paid + v_conv;
  end loop;
  if v_paid <> v_total then
    raise exception 'payments (%) must equal the sale total (%) exactly', v_paid, v_total using errcode = '22023';
  end if;

  update public.sales set subtotal = v_subtotal, discount_total = v_discount, total = v_total where id = v_sale;
  perform public.write_audit(p_store, 'sale.completed', 'sale', v_sale, jsonb_build_object('receipt', v_receipt, 'total', v_total, 'currency', p_currency));
  return public.build_receipt(v_sale);
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.open_shift(uuid, numeric, numeric), public.record_cash_movement(uuid, text, public.currency, numeric, text),
  public.close_shift(uuid, numeric, numeric, text), public.get_shift_summary(uuid), public.get_receipt(uuid),
  public.log_receipt_print(uuid, boolean),
  public.checkout(uuid, uuid, public.currency, jsonb, jsonb, text)
  to authenticated;
