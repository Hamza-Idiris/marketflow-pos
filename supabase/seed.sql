-- LOCAL DEVELOPMENT ONLY. Never run this against a production project.
-- Password for every demo user: Passw0rd!demo
do $$
declare
  u record;
  pw text := crypt('Passw0rd!demo', gen_salt('bf'));
begin
  for u in select * from (values
    ('00000000-0000-0000-0000-00000000d001'::uuid, 'super@demo.local',   'Sahra Super Admin'),
    ('00000000-0000-0000-0000-00000000d002'::uuid, 'admin@demo.local',   'Abdi Store Admin'),
    ('00000000-0000-0000-0000-00000000d003'::uuid, 'stock@demo.local',   'Hodan Stock Staff'),
    ('00000000-0000-0000-0000-00000000d004'::uuid, 'cashier@demo.local', 'Warsame Cashier'),
    ('00000000-0000-0000-0000-00000000d005'::uuid, 'admin-b@demo.local', 'Ifrah Store B Admin')
  ) as t(id, email, full_name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, pw, now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.full_name), now(), now(),
      '', '', '', '')
    on conflict (id) do nothing;

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text,
            jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now())
    on conflict do nothing;
  end loop;
end $$;

update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-00000000d001';

insert into public.supermarkets (id, name, slug, phone, address) values
  ('00000000-0000-0000-0000-00000000e001', 'Hamar Fresh Market', 'hamar-fresh', '+252 61 000 0001', 'Mogadishu'),
  ('00000000-0000-0000-0000-00000000e002', 'Shabelle Mini Mart', 'shabelle-mini', '+252 61 000 0002', 'Mogadishu')
on conflict (id) do nothing;

insert into public.supermarket_members (supermarket_id, user_id, role, cashier_max_discount_pct) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000d002', 'admin', 0),
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000d003', 'stock_staff', 0),
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000d004', 'cashier', 5),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-00000000d005', 'admin', 0)
on conflict (supermarket_id, user_id) do nothing;

-- ---- demo catalog and stock for Hamar Fresh Market (local development only) ----
insert into public.exchange_rates (supermarket_id, sos_per_usd, created_by)
select '00000000-0000-0000-0000-00000000e001', 570, '00000000-0000-0000-0000-00000000d002'
where not exists (select 1 from public.exchange_rates where supermarket_id = '00000000-0000-0000-0000-00000000e001');

insert into public.units (id, supermarket_id, name, abbreviation) values
  ('00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-00000000e001', 'Piece', 'pc'),
  ('00000000-0000-0000-0000-0000000f0002', '00000000-0000-0000-0000-00000000e001', 'Kilogram', 'kg')
on conflict do nothing;
insert into public.categories (id, supermarket_id, name) values
  ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-00000000e001', 'Groceries'),
  ('00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-00000000e001', 'Dairy'),
  ('00000000-0000-0000-0000-0000000c0003', '00000000-0000-0000-0000-00000000e001', 'Drinks')
on conflict do nothing;

insert into public.products (id, supermarket_id, category_id, unit_id, name, sku, barcode, min_stock, track_expiry) values
  ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-0000000f0002', 'Rice 5kg', 'RICE-5', '6001001', 10, false),
  ('00000000-0000-0000-0000-0000000a0002', '00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-0000000f0001', 'Sugar 1kg', 'SUG-1', '6001002', 10, false),
  ('00000000-0000-0000-0000-0000000a0003', '00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-0000000f0001', 'Fresh Milk 1L', 'MLK-1', '6001003', 12, true),
  ('00000000-0000-0000-0000-0000000a0004', '00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000c0003', '00000000-0000-0000-0000-0000000f0001', 'Mango Juice 1L', 'JCE-1', '6001004', 8, true),
  ('00000000-0000-0000-0000-0000000a0005', '00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-0000000f0001', 'Spaghetti 500g', 'SPG-5', '6001005', 10, false)
on conflict do nothing;
insert into public.product_prices (supermarket_id, product_id, currency, price) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000a0001', 'USD', 9.50), ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000a0001', 'SOS', 5400),
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000a0002', 'USD', 1.20), ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000a0002', 'SOS', 700),
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000a0003', 'USD', 1.50), ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000a0003', 'SOS', 850),
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000a0004', 'USD', 2.00), ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000a0004', 'SOS', 1150),
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000a0005', 'USD', 1.00), ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000a0005', 'SOS', 570)
on conflict do nothing;

do $$
declare p record; v_lot uuid;
begin
  if exists (select 1 from public.inventory_lots where supermarket_id = '00000000-0000-0000-0000-00000000e001') then return; end if;
  for p in select * from (values
    ('00000000-0000-0000-0000-0000000a0001'::uuid, 40, 8.00, null::date), ('00000000-0000-0000-0000-0000000a0002'::uuid, 60, 0.90, null),
    ('00000000-0000-0000-0000-0000000a0003'::uuid, 30, 1.10, current_date + 6), ('00000000-0000-0000-0000-0000000a0004'::uuid, 24, 1.40, current_date + 120),
    ('00000000-0000-0000-0000-0000000a0005'::uuid, 50, 0.70, null)) as t(id, qty, cost, exp)
  loop
    insert into public.inventory_lots (supermarket_id, product_id, lot_number, expiry_date, quantity_received, quantity_remaining, unit_cost, cost_currency)
    values ('00000000-0000-0000-0000-00000000e001', p.id, 'SEED-1', p.exp, p.qty, p.qty, p.cost, 'USD') returning id into v_lot;
    insert into public.stock_movements (supermarket_id, product_id, lot_id, movement_type, quantity, reason, created_by)
    values ('00000000-0000-0000-0000-00000000e001', p.id, v_lot, 'receipt', p.qty, 'Seed data', '00000000-0000-0000-0000-00000000d003');
  end loop;
end $$;
