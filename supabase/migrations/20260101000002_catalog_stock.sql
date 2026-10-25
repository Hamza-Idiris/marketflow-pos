-- Phases 2-4: catalog, suppliers, purchasing, receiving, FIFO lots, stock ledger.

create type public.currency as enum ('USD', 'SOS');
create type public.po_status as enum ('draft', 'ordered', 'partially_received', 'received', 'cancelled');
create type public.movement_type as enum ('receipt', 'sale', 'refund_return', 'adjustment', 'write_off');

create or replace function public.store_today() returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Africa/Mogadishu')::date;
$$;

create or replace function public.round_money(n numeric, c public.currency) returns numeric
language sql immutable set search_path = '' as $$
  select case when c = 'SOS' then round(n, 0) else round(n, 2) end;
$$;

create or replace function public.forbid_change() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% on % is not allowed: this is an immutable ledger', tg_op, tg_table_name using errcode = '42501';
end $$;

create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_logs (supermarket_id, actor_id, action, entity_type, entity_id, details)
  values (r.supermarket_id, auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name, r.id,
          case when tg_op = 'UPDATE' then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
               else jsonb_build_object('row', to_jsonb(r)) end);
  return r;
end $$;

-- ---------------------------------------------------------------- settings
create table public.store_settings (
  supermarket_id uuid primary key references public.supermarkets (id) on delete restrict,
  expiry_warning_days int not null default 30 check (expiry_warning_days between 1 and 365),
  receipt_footer text not null default 'Thank you for shopping with us!',
  updated_at timestamptz not null default now()
);
insert into public.store_settings (supermarket_id) select id from public.supermarkets on conflict do nothing;

create or replace function public.init_store_settings() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.store_settings (supermarket_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger supermarkets_init_settings after insert on public.supermarkets
  for each row execute function public.init_store_settings();

-- Exchange-rate convention: sos_per_usd = how many SOS equal 1 USD. Rows are append-only history.
create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  sos_per_usd numeric(14, 4) not null check (sos_per_usd > 0),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index exchange_rates_latest_idx on public.exchange_rates (supermarket_id, created_at desc);
create trigger exchange_rates_immutable before update or delete on public.exchange_rates
  for each row execute function public.forbid_change();

create table public.store_counters (
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  name text not null,
  value bigint not null default 0,
  primary key (supermarket_id, name)
);

create or replace function public.store_rate(p_store uuid) returns numeric language sql stable security definer set search_path = '' as $$
  select sos_per_usd from public.exchange_rates where supermarket_id = p_store order by created_at desc, id desc limit 1;
$$;

-- ------------------------------------------------------------------ catalog
create table public.units (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  name text not null check (char_length(btrim(name)) > 0),
  abbreviation text not null check (char_length(btrim(abbreviation)) > 0),
  created_at timestamptz not null default now(),
  unique (id, supermarket_id), unique (supermarket_id, name)
);
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  name text not null check (char_length(btrim(name)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, supermarket_id), unique (supermarket_id, name)
);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  category_id uuid, unit_id uuid,
  name text not null check (char_length(btrim(name)) > 0),
  sku text check (sku is null or sku <> ''),
  barcode text check (barcode is null or barcode <> ''),
  image_path text,
  min_stock numeric(14, 3) not null default 0 check (min_stock >= 0),
  track_expiry boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, supermarket_id),
  foreign key (category_id, supermarket_id) references public.categories (id, supermarket_id),
  foreign key (unit_id, supermarket_id) references public.units (id, supermarket_id)
);
create unique index products_barcode_uq on public.products (supermarket_id, barcode) where barcode is not null;
create unique index products_sku_uq on public.products (supermarket_id, sku) where sku is not null;
create index products_name_idx on public.products (supermarket_id, lower(name));
create table public.product_prices (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  product_id uuid not null,
  currency public.currency not null,
  price numeric(14, 2) not null check (price >= 0),
  unique (product_id, currency),
  foreign key (product_id, supermarket_id) references public.products (id, supermarket_id)
);
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  name text not null check (char_length(btrim(name)) > 0),
  phone text, email text, address text, notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, supermarket_id), unique (supermarket_id, name)
);
create trigger products_updated before update on public.products for each row execute function public.set_updated_at();
create trigger products_audit after insert or update on public.products for each row execute function public.audit_row_change();
create trigger prices_audit after insert or update on public.product_prices for each row execute function public.audit_row_change();

-- --------------------------------------------------------------- purchasing
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  supplier_id uuid not null,
  reference text,
  status public.po_status not null default 'draft',
  currency public.currency not null default 'USD',
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, supermarket_id),
  foreign key (supplier_id, supermarket_id) references public.suppliers (id, supermarket_id)
);
create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  purchase_order_id uuid not null,
  product_id uuid not null,
  quantity_ordered numeric(14, 3) not null check (quantity_ordered > 0),
  quantity_received numeric(14, 3) not null default 0 check (quantity_received >= 0),
  unit_cost numeric(14, 4) not null check (unit_cost >= 0),
  unique (id, supermarket_id),
  foreign key (purchase_order_id, supermarket_id) references public.purchase_orders (id, supermarket_id) on delete cascade,
  foreign key (product_id, supermarket_id) references public.products (id, supermarket_id)
);
create table public.stock_receipts (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  supplier_id uuid, purchase_order_id uuid,
  reference text, received_on date not null default current_date, notes text,
  received_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (id, supermarket_id),
  foreign key (supplier_id, supermarket_id) references public.suppliers (id, supermarket_id),
  foreign key (purchase_order_id, supermarket_id) references public.purchase_orders (id, supermarket_id)
);
create table public.stock_receipt_items (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  receipt_id uuid not null, product_id uuid not null, po_item_id uuid,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_cost numeric(14, 4) not null check (unit_cost >= 0),
  cost_currency public.currency not null,
  lot_number text, expiry_date date,
  unique (id, supermarket_id),
  foreign key (receipt_id, supermarket_id) references public.stock_receipts (id, supermarket_id),
  foreign key (product_id, supermarket_id) references public.products (id, supermarket_id)
);
create table public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,  -- strict FIFO tie-break within one transaction
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  product_id uuid not null, receipt_item_id uuid,
  lot_number text,
  received_at timestamptz not null default now(),
  expiry_date date,
  quantity_received numeric(14, 3) not null check (quantity_received > 0),
  quantity_remaining numeric(14, 3) not null check (quantity_remaining >= 0),
  unit_cost numeric(14, 4) not null check (unit_cost >= 0),
  cost_currency public.currency not null,
  unique (id, supermarket_id),
  check (quantity_remaining <= quantity_received),
  foreign key (product_id, supermarket_id) references public.products (id, supermarket_id)
);
create index inventory_lots_fifo_idx on public.inventory_lots (supermarket_id, product_id, received_at, seq) where quantity_remaining > 0;
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  product_id uuid not null, lot_id uuid,
  movement_type public.movement_type not null,
  quantity numeric(14, 3) not null check (quantity <> 0),
  reference_type text, reference_id uuid, reason text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  foreign key (product_id, supermarket_id) references public.products (id, supermarket_id),
  foreign key (lot_id, supermarket_id) references public.inventory_lots (id, supermarket_id)
);
create index stock_movements_idx on public.stock_movements (supermarket_id, created_at desc);
create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function public.forbid_change();
create trigger po_updated before update on public.purchase_orders for each row execute function public.set_updated_at();

-- -------------------------------------------------------- RLS and privileges
do $$
declare t text;
begin
  foreach t in array array['units','categories','products','product_prices','suppliers'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_access_store(supermarket_id))', t || '_select', t);
    execute format($p$create policy %I on public.%I for insert to authenticated with check (public.has_store_role(supermarket_id, array['admin']::public.app_role[]))$p$, t || '_insert', t);
    execute format($p$create policy %I on public.%I for update to authenticated using (public.has_store_role(supermarket_id, array['admin']::public.app_role[])) with check (public.has_store_role(supermarket_id, array['admin']::public.app_role[]))$p$, t || '_update', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
  -- read-only (writes only through RPCs)
  foreach t in array array['purchase_orders','purchase_order_items','stock_receipts','stock_receipt_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (public.can_access_store(supermarket_id) and (public.is_super_admin() or public.has_store_role(supermarket_id, array['admin','stock_staff']::public.app_role[])))$p$, t || '_select', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  foreach t in array array['inventory_lots','stock_movements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (public.is_super_admin() or public.has_store_role(supermarket_id, array['admin','stock_staff']::public.app_role[]))$p$, t || '_select', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

alter table public.store_settings enable row level security;
create policy settings_select on public.store_settings for select to authenticated using (public.can_access_store(supermarket_id));
alter table public.exchange_rates enable row level security;
create policy rates_select on public.exchange_rates for select to authenticated using (public.can_access_store(supermarket_id));
alter table public.store_counters enable row level security;
grant select on public.store_settings, public.exchange_rates to authenticated;

-- ---------------------------------------------------------------- RPCs
create or replace function public.can_manage_store_members(p_store uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_super_admin() or public.has_store_role(p_store, array['admin']::public.app_role[]);
$$;

create or replace function public.update_store_settings(p_store uuid, p_expiry_days int, p_footer text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_store_role(p_store, array['admin']::public.app_role[]) then
    raise exception 'only the store admin can change settings' using errcode = '42501';
  end if;
  update public.store_settings set expiry_warning_days = p_expiry_days, receipt_footer = coalesce(nullif(btrim(p_footer), ''), receipt_footer), updated_at = now()
   where supermarket_id = p_store;
  perform public.write_audit(p_store, 'settings.updated', 'store_settings', null, jsonb_build_object('expiry_days', p_expiry_days));
end $$;

create or replace function public.set_exchange_rate(p_store uuid, p_sos_per_usd numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.has_store_role(p_store, array['admin']::public.app_role[]) then
    raise exception 'only the store admin can change exchange rates' using errcode = '42501';
  end if;
  if p_sos_per_usd is null or p_sos_per_usd <= 0 then raise exception 'rate must be positive' using errcode = '22023'; end if;
  insert into public.exchange_rates (supermarket_id, sos_per_usd, created_by) values (p_store, p_sos_per_usd, auth.uid()) returning id into v_id;
  perform public.write_audit(p_store, 'exchange_rate.set', 'exchange_rate', v_id, jsonb_build_object('sos_per_usd', p_sos_per_usd));
  return v_id;
end $$;

-- Create or replace a DRAFT purchase order. p_items: [{product_id, quantity_ordered, unit_cost}]
create or replace function public.save_purchase_order(
  p_store uuid, p_id uuid, p_supplier uuid, p_reference text, p_currency public.currency, p_notes text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id; v_status public.po_status; e jsonb;
begin
  if not public.has_store_role(p_store, array['admin']::public.app_role[]) then
    raise exception 'only the store admin can manage purchase orders' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'add at least one item' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.purchase_orders (supermarket_id, supplier_id, reference, currency, notes, created_by)
    values (p_store, p_supplier, nullif(btrim(p_reference), ''), p_currency, p_notes, auth.uid()) returning id into v_id;
  else
    select status into v_status from public.purchase_orders where id = v_id and supermarket_id = p_store for update;
    if not found then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
    if v_status <> 'draft' then raise exception 'only draft orders can be edited' using errcode = '22023'; end if;
    update public.purchase_orders set supplier_id = p_supplier, reference = nullif(btrim(p_reference), ''), currency = p_currency, notes = p_notes where id = v_id;
    delete from public.purchase_order_items where purchase_order_id = v_id;
  end if;
  for e in select * from jsonb_array_elements(p_items) loop
    insert into public.purchase_order_items (supermarket_id, purchase_order_id, product_id, quantity_ordered, unit_cost)
    values (p_store, v_id, (e ->> 'product_id')::uuid, (e ->> 'quantity_ordered')::numeric, (e ->> 'unit_cost')::numeric);
  end loop;
  perform public.write_audit(p_store, 'purchase_order.saved', 'purchase_order', v_id, '{}'::jsonb);
  return v_id;
end $$;

create or replace function public.set_po_status(p_id uuid, p_status public.po_status)
returns void language plpgsql security definer set search_path = '' as $$
declare po public.purchase_orders;
begin
  select * into po from public.purchase_orders where id = p_id for update;
  if not found then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  if not public.has_store_role(po.supermarket_id, array['admin']::public.app_role[]) then
    raise exception 'only the store admin can manage purchase orders' using errcode = '42501';
  end if;
  if not ((po.status = 'draft' and p_status in ('ordered', 'cancelled'))
       or (po.status = 'ordered' and p_status = 'cancelled')) then
    raise exception 'cannot change status from % to %', po.status, p_status using errcode = '22023';
  end if;
  update public.purchase_orders set status = p_status where id = p_id;
  perform public.write_audit(po.supermarket_id, 'purchase_order.' || p_status, 'purchase_order', p_id, '{}'::jsonb);
end $$;

-- Receive stock; creates receipt, lots and ledger rows atomically.
-- p_items: [{product_id, quantity, unit_cost, cost_currency, lot_number, expiry_date, po_item_id}]
create or replace function public.receive_stock(
  p_store uuid, p_supplier uuid, p_po uuid, p_reference text, p_received_on date, p_notes text,
  p_items jsonb, p_override boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_receipt uuid; e jsonb; v_prod public.products; v_qty numeric; v_cost numeric; v_cur public.currency;
  v_exp date; v_item uuid; v_lot uuid; v_poi public.purchase_order_items; v_po public.purchase_orders; v_outstanding numeric;
begin
  if not public.has_store_role(p_store, array['admin', 'stock_staff']::public.app_role[]) then
    raise exception 'only admin or stock staff can receive stock' using errcode = '42501';
  end if;
  if p_override and not public.has_store_role(p_store, array['admin']::public.app_role[]) then
    raise exception 'only an admin can override order quantities' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'add at least one item' using errcode = '22023';
  end if;
  if p_po is not null then
    select * into v_po from public.purchase_orders where id = p_po and supermarket_id = p_store for update;
    if not found then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
    if v_po.status not in ('ordered', 'partially_received') then
      raise exception 'purchase order is not open for receiving' using errcode = '22023';
    end if;
  end if;
  insert into public.stock_receipts (supermarket_id, supplier_id, purchase_order_id, reference, received_on, notes, received_by)
  values (p_store, coalesce(p_supplier, v_po.supplier_id), p_po, nullif(btrim(p_reference), ''), coalesce(p_received_on, public.store_today()), p_notes, auth.uid())
  returning id into v_receipt;

  for e in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from public.products where id = (e ->> 'product_id')::uuid and supermarket_id = p_store and is_active;
    if not found then raise exception 'product not found or inactive' using errcode = 'P0002'; end if;
    v_qty := (e ->> 'quantity')::numeric; v_cost := (e ->> 'unit_cost')::numeric;
    v_cur := (e ->> 'cost_currency')::public.currency; v_exp := nullif(e ->> 'expiry_date', '')::date;
    if v_qty is null or v_qty <= 0 or v_qty <> round(v_qty, 3) then raise exception 'invalid quantity for %', v_prod.name using errcode = '22023'; end if;
    if v_cost is null or v_cost < 0 then raise exception 'invalid cost for %', v_prod.name using errcode = '22023'; end if;
    if v_prod.track_expiry and v_exp is null then raise exception 'expiry date required for %', v_prod.name using errcode = '22023'; end if;
    if v_exp is not null and v_exp < public.store_today() then raise exception 'cannot receive already-expired stock for %', v_prod.name using errcode = '22023'; end if;
    if nullif(e ->> 'po_item_id', '') is not null then
      select * into v_poi from public.purchase_order_items where id = (e ->> 'po_item_id')::uuid and purchase_order_id = p_po and product_id = v_prod.id for update;
      if not found then raise exception 'order line does not match product %', v_prod.name using errcode = '22023'; end if;
      v_outstanding := v_poi.quantity_ordered - v_poi.quantity_received;
      if v_qty > v_outstanding and not p_override then
        raise exception 'quantity for % exceeds outstanding order quantity (%)', v_prod.name, v_outstanding using errcode = '22023';
      end if;
      update public.purchase_order_items set quantity_received = quantity_received + v_qty where id = v_poi.id;
    elsif p_po is not null then
      raise exception 'each received line must reference an order line' using errcode = '22023';
    end if;
    insert into public.stock_receipt_items (supermarket_id, receipt_id, product_id, po_item_id, quantity, unit_cost, cost_currency, lot_number, expiry_date)
    values (p_store, v_receipt, v_prod.id, nullif(e ->> 'po_item_id', '')::uuid, v_qty, v_cost, v_cur, nullif(btrim(e ->> 'lot_number'), ''), v_exp)
    returning id into v_item;
    insert into public.inventory_lots (supermarket_id, product_id, receipt_item_id, lot_number, expiry_date, quantity_received, quantity_remaining, unit_cost, cost_currency)
    values (p_store, v_prod.id, v_item, nullif(btrim(e ->> 'lot_number'), ''), v_exp, v_qty, v_qty, v_cost, v_cur) returning id into v_lot;
    insert into public.stock_movements (supermarket_id, product_id, lot_id, movement_type, quantity, reference_type, reference_id, created_by)
    values (p_store, v_prod.id, v_lot, 'receipt', v_qty, 'stock_receipt', v_receipt, auth.uid());
  end loop;

  if p_po is not null then
    update public.purchase_orders set status = case
      when not exists (select 1 from public.purchase_order_items where purchase_order_id = p_po and quantity_received < quantity_ordered) then 'received'::public.po_status
      else 'partially_received'::public.po_status end where id = p_po;
  end if;
  perform public.write_audit(p_store, 'stock.received', 'stock_receipt', v_receipt, jsonb_build_object('override', p_override));
  return v_receipt;
end $$;

-- Reduce a lot (damage, expiry write-off, correction). Admin only; reason mandatory.
create or replace function public.adjust_lot(p_lot uuid, p_quantity numeric, p_reason text, p_write_off boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.inventory_lots;
begin
  select * into l from public.inventory_lots where id = p_lot for update;
  if not found then raise exception 'lot not found' using errcode = 'P0002'; end if;
  if not public.has_store_role(l.supermarket_id, array['admin']::public.app_role[]) then
    raise exception 'only the store admin can adjust stock' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity <> round(p_quantity, 3) then raise exception 'quantity must be positive' using errcode = '22023'; end if;
  if p_quantity > l.quantity_remaining then raise exception 'cannot remove more than the remaining % units', l.quantity_remaining using errcode = '22023'; end if;
  update public.inventory_lots set quantity_remaining = quantity_remaining - p_quantity where id = p_lot;
  insert into public.stock_movements (supermarket_id, product_id, lot_id, movement_type, quantity, reference_type, reason, created_by)
  values (l.supermarket_id, l.product_id, l.id, case when p_write_off then 'write_off' else 'adjustment' end::public.movement_type, -p_quantity, 'lot', btrim(p_reason), auth.uid());
  perform public.write_audit(l.supermarket_id, case when p_write_off then 'stock.write_off' else 'stock.adjustment' end, 'inventory_lot', l.id,
    jsonb_build_object('quantity', p_quantity, 'reason', p_reason));
end $$;

-- Per-product stock summary. security_invoker => lots RLS applies (admin / stock staff only).
create view public.inventory_overview with (security_invoker = true) as
select p.id as product_id, p.supermarket_id, p.name, p.sku, p.barcode, p.min_stock, p.is_active, p.category_id,
  coalesce(sum(l.quantity_remaining) filter (where l.expiry_date is null or l.expiry_date >= public.store_today()), 0) as available,
  coalesce(sum(l.quantity_remaining) filter (where l.expiry_date < public.store_today()), 0) as expired_quantity,
  min(l.expiry_date) filter (where l.quantity_remaining > 0 and l.expiry_date >= public.store_today()) as next_expiry,
  coalesce(sum(l.quantity_remaining * l.unit_cost) filter (where l.cost_currency = 'USD'), 0) as value_usd,
  coalesce(sum(l.quantity_remaining * l.unit_cost) filter (where l.cost_currency = 'SOS'), 0) as value_sos
from public.products p
left join public.inventory_lots l on l.product_id = p.id and l.quantity_remaining > 0
group by p.id;
grant select on public.inventory_overview to authenticated;

-- Catalog with prices and stock for the POS (cashiers must not see lot costs).
create or replace function public.pos_catalog(p_store uuid)
returns table (product_id uuid, name text, sku text, barcode text, category_id uuid, image_path text,
               usd_price numeric, sos_price numeric, available numeric, min_stock numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_store_role(p_store, array['cashier', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select p.id, p.name, p.sku, p.barcode, p.category_id, p.image_path,
    (select pp.price from public.product_prices pp where pp.product_id = p.id and pp.currency = 'USD'),
    (select pp.price from public.product_prices pp where pp.product_id = p.id and pp.currency = 'SOS'),
    coalesce((select sum(l.quantity_remaining) from public.inventory_lots l
              where l.product_id = p.id and (l.expiry_date is null or l.expiry_date >= public.store_today())), 0),
    p.min_stock
  from public.products p where p.supermarket_id = p_store and p.is_active order by p.name;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.store_today(), public.round_money(numeric, public.currency), public.store_rate(uuid),
  public.can_manage_store_members(uuid), public.update_store_settings(uuid, int, text),
  public.set_exchange_rate(uuid, numeric),
  public.save_purchase_order(uuid, uuid, uuid, text, public.currency, text, jsonb),
  public.set_po_status(uuid, public.po_status),
  public.receive_stock(uuid, uuid, uuid, text, date, text, jsonb, boolean),
  public.adjust_lot(uuid, numeric, text, boolean), public.pos_catalog(uuid)
  to authenticated;
revoke execute on function public.store_rate(uuid) from authenticated;
