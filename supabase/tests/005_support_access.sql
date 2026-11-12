-- Support access tests: Super admin support access workflow and isolation.
-- Run against a PostgreSQL / Supabase database.
-- Everything runs in one transaction and is rolled back at the end.
begin;

create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  perform set_config('request.jwt.claims',
    case when uid is null then '{}' else json_build_object('sub', uid, 'role', 'authenticated')::text end, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.as_admin() returns void language plpgsql as $$
begin execute 'reset role'; end $$;

create or replace function pg_temp.expect_error(sql text, label text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    raise notice 'ok - % [%]', label, left(sqlerrm, 70);
    return;
  end;
  raise exception 'TEST FAILED (expected error): %', label;
end $$;

create or replace function pg_temp.expect(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'TEST FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;

-- Fixtures ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('f0000000-0000-0000-0000-000000000001', 'super@t.local',   '{"full_name":"Super Admin"}'),
  ('f0000000-0000-0000-0000-000000000002', 'admin-a@t.local', '{"full_name":"Admin A"}'),
  ('f0000000-0000-0000-0000-000000000003', 'admin-b@t.local', '{"full_name":"Admin B"}'),
  ('f0000000-0000-0000-0000-000000000004', 'cashier-a@t.local','{"full_name":"Cashier A"}'),
  ('f0000000-0000-0000-0000-000000000005', 'stock-a@t.local',  '{"full_name":"Stock A"}');

update public.profiles set is_super_admin = true where id = 'f0000000-0000-0000-0000-000000000001';

insert into public.supermarkets (id, name, slug) values
  ('faaaaaaa-0000-0000-0000-000000000001', 'Store Alpha', 'store-alpha'),
  ('fbbbbbbb-0000-0000-0000-000000000001', 'Store Beta',  'store-beta');

insert into public.supermarket_members (supermarket_id, user_id, role, cashier_max_discount_pct) values
  ('faaaaaaa-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 'admin', 0),
  ('faaaaaaa-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000004', 'cashier', 10),
  ('faaaaaaa-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000005', 'stock_staff', 0),
  ('fbbbbbbb-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000003', 'admin', 0);

-- Insert sample store data as admin A
select pg_temp.as_user('f0000000-0000-0000-0000-000000000002');
insert into public.products (id, supermarket_id, name, barcode) values
  ('fc000000-0000-0000-0000-000000000001', 'faaaaaaa-0000-0000-0000-000000000001', 'Product Alpha', '123456');

select pg_temp.as_admin();
insert into public.inventory_lots (id, supermarket_id, product_id, quantity_received, quantity_remaining, unit_cost, cost_currency) values
  ('fd000000-0000-0000-0000-000000000001', 'faaaaaaa-0000-0000-0000-000000000001', 'fc000000-0000-0000-0000-000000000001', 50, 50, 1.00, 'USD');

insert into public.sales (id, supermarket_id, receipt_number, cashier_id, currency, subtotal, discount_total, total) values
  ('fe000000-0000-0000-0000-000000000001', 'faaaaaaa-0000-0000-0000-000000000001', 'RCP-001', 'f0000000-0000-0000-0000-000000000004', 'USD', 10.00, 0, 10.00);

insert into public.payments (id, supermarket_id, sale_id, method, amount, currency, converted_amount, cashier_id) values
  ('fe100000-0000-0000-0000-000000000001', 'faaaaaaa-0000-0000-0000-000000000001', 'fe000000-0000-0000-0000-000000000001', 'cash', 10.00, 'USD', 10.00, 'f0000000-0000-0000-0000-000000000004');

insert into public.expenses (id, supermarket_id, category, amount, currency, reason, created_by) values
  ('fe200000-0000-0000-0000-000000000001', 'faaaaaaa-0000-0000-0000-000000000001', 'supplies', 5.00, 'USD', 'Pens and paper', 'f0000000-0000-0000-0000-000000000002');

-- 1. Super admin without grant: reads 0 rows of sales/payments/expenses/lots
select pg_temp.as_user('f0000000-0000-0000-0000-000000000001');

select pg_temp.expect((select count(*) from public.sales where supermarket_id = 'faaaaaaa-0000-0000-0000-000000000001') = 0, 'super admin without grant reads 0 sales');
select pg_temp.expect((select count(*) from public.payments where supermarket_id = 'faaaaaaa-0000-0000-0000-000000000001') = 0, 'super admin without grant reads 0 payments');
select pg_temp.expect((select count(*) from public.expenses where supermarket_id = 'faaaaaaa-0000-0000-0000-000000000001') = 0, 'super admin without grant reads 0 expenses');
select pg_temp.expect((select count(*) from public.inventory_lots where supermarket_id = 'faaaaaaa-0000-0000-0000-000000000001') = 0, 'super admin without grant reads 0 lots');

-- Platform summary and supermarket listing still work
select pg_temp.expect((select count(*) from public.platform_summary() where store_id = 'faaaaaaa-0000-0000-0000-000000000001') = 1, 'platform_summary still works for super admin');
select pg_temp.expect((select count(*) from public.supermarkets) >= 2, 'super admin can list supermarkets');

-- Super admin can invite admins
select pg_temp.expect(
  public.invite_member('faaaaaaa-0000-0000-0000-000000000001', 'new-admin@t.local', 'New Admin', 'admin', 0) in ('invited', 'added'),
  'super admin can invite admin'
);

-- 2. Staff cannot request, approve or see grants
select pg_temp.as_user('f0000000-0000-0000-0000-000000000004'); -- cashier
select pg_temp.expect((select count(*) from public.access_grants) = 0, 'cashier cannot see access_grants');
select pg_temp.expect_error($$select public.request_access('faaaaaaa-0000-0000-0000-000000000001', 'Support ticket')$$, 'cashier cannot request access');
select pg_temp.as_user('f0000000-0000-0000-0000-000000000005'); -- stock staff
select pg_temp.expect_error($$select public.request_access('faaaaaaa-0000-0000-0000-000000000001', 'Support ticket')$$, 'stock staff cannot request access');

-- 3. Super admin requests access
select pg_temp.as_user('f0000000-0000-0000-0000-000000000001');
select pg_temp.expect_error($$select public.request_access('faaaaaaa-0000-0000-0000-000000000001', 'Hi')$$, 'reason < 5 chars rejected');

do $$
declare v_req uuid;
begin
  v_req := public.request_access('faaaaaaa-0000-0000-0000-000000000001', 'Investigating payment discrepancy');
  perform set_config('test.grant_id', v_req::text, true);
end $$;

-- One pending request per store
select pg_temp.expect_error(
  $$select public.request_access('faaaaaaa-0000-0000-0000-000000000001', 'Another request')$$,
  'cannot request twice when pending'
);

-- Audit log written for request
select pg_temp.as_admin();
select pg_temp.expect(
  exists (select 1 from public.audit_logs where supermarket_id = 'faaaaaaa-0000-0000-0000-000000000001' and action = 'access.requested'),
  'audit_log written for access.requested'
);

-- 4. Admin of ANOTHER store cannot approve
select pg_temp.as_user('f0000000-0000-0000-0000-000000000003'); -- admin B
select pg_temp.expect_error(
  format($$select public.decide_access('%s'::uuid, true, 24)$$, current_setting('test.grant_id')),
  'admin of another store cannot approve'
);

-- 5. Admin of that store approves
select pg_temp.as_user('f0000000-0000-0000-0000-000000000002'); -- admin A
select pg_temp.expect(
  (select count(*) from public.access_grants where id = current_setting('test.grant_id')::uuid) = 1,
  'admin A can see the pending grant'
);
execute format($$select public.decide_access('%s'::uuid, true, 4)$$, current_setting('test.grant_id'));

-- Audit log written for approve
select pg_temp.as_admin();
select pg_temp.expect(
  exists (select 1 from public.audit_logs where supermarket_id = 'faaaaaaa-0000-0000-0000-000000000001' and action = 'access.approved'),
  'audit_log written for access.approved'
);

-- 6. Super admin now reads sales and detailed data
select pg_temp.as_user('f0000000-0000-0000-0000-000000000001');
select pg_temp.expect((select count(*) from public.sales where supermarket_id = 'faaaaaaa-0000-0000-0000-000000000001') = 1, 'super admin with approved grant reads sales');
select pg_temp.expect((select count(*) from public.payments where supermarket_id = 'faaaaaaa-0000-0000-0000-000000000001') = 1, 'super admin with approved grant reads payments');
select pg_temp.expect((select count(*) from public.expenses where supermarket_id = 'faaaaaaa-0000-0000-0000-000000000001') = 1, 'super admin with approved grant reads expenses');
select pg_temp.expect((select count(*) from public.inventory_lots where supermarket_id = 'faaaaaaa-0000-0000-0000-000000000001') = 1, 'super admin with approved grant reads inventory_lots');

-- Grant is READ-ONLY: super admin cannot write
select pg_temp.expect_error(
  $$insert into public.products (supermarket_id, name) values ('faaaaaaa-0000-0000-0000-000000000001', 'Hacked Prod')$$,
  'super admin with grant cannot insert product'
);
select pg_temp.expect_error(
  $$select public.update_store_settings('faaaaaaa-0000-0000-0000-000000000001', 15, 'footer')$$,
  'super admin with grant cannot update store settings via RPC'
);

-- 7. Revoke grant -> gives 0 rows again
execute format($$select public.revoke_access('%s'::uuid)$$, current_setting('test.grant_id'));

select pg_temp.expect((select count(*) from public.sales where supermarket_id = 'faaaaaaa-0000-0000-0000-000000000001') = 0, 'super admin with revoked grant reads 0 sales');
select pg_temp.expect((select count(*) from public.payments where supermarket_id = 'faaaaaaa-0000-0000-0000-000000000001') = 0, 'super admin with revoked grant reads 0 payments');

-- Audit log written for revoke
select pg_temp.as_admin();
select pg_temp.expect(
  exists (select 1 from public.audit_logs where supermarket_id = 'faaaaaaa-0000-0000-0000-000000000001' and action = 'access.revoked'),
  'audit_log written for access.revoked'
);

-- 8. Denied grant test
select pg_temp.as_user('f0000000-0000-0000-0000-000000000001');
do $$
declare v_req2 uuid;
begin
  v_req2 := public.request_access('faaaaaaa-0000-0000-0000-000000000001', 'Second request check');
  perform set_config('test.grant_id2', v_req2::text, true);
end $$;

select pg_temp.as_user('f0000000-0000-0000-0000-000000000002'); -- admin A denies
execute format($$select public.decide_access('%s'::uuid, false)$$, current_setting('test.grant_id2'));

select pg_temp.as_user('f0000000-0000-0000-0000-000000000001'); -- super admin
select pg_temp.expect((select count(*) from public.sales where supermarket_id = 'faaaaaaa-0000-0000-0000-000000000001') = 0, 'denied grant gives 0 sales');

-- Audit log written for deny
select pg_temp.as_admin();
select pg_temp.expect(
  exists (select 1 from public.audit_logs where supermarket_id = 'faaaaaaa-0000-0000-0000-000000000001' and action = 'access.denied'),
  'audit_log written for access.denied'
);

-- 9. Expired grant test
select pg_temp.as_user('f0000000-0000-0000-0000-000000000001');
do $$
declare v_req3 uuid;
begin
  v_req3 := public.request_access('faaaaaaa-0000-0000-0000-000000000001', 'Third request for expiry');
  perform set_config('test.grant_id3', v_req3::text, true);
end $$;

select pg_temp.as_user('f0000000-0000-0000-0000-000000000002'); -- admin A approves
execute format($$select public.decide_access('%s'::uuid, true, 1)$$, current_setting('test.grant_id3'));

-- Manually expire the grant in DB
select pg_temp.as_admin();
execute format($$update public.access_grants set expires_at = now() - interval '1 second' where id = '%s'::uuid$$, current_setting('test.grant_id3'));

select pg_temp.as_user('f0000000-0000-0000-0000-000000000001'); -- super admin
select pg_temp.expect((select count(*) from public.sales where supermarket_id = 'faaaaaaa-0000-0000-0000-000000000001') = 0, 'expired grant gives 0 sales');

rollback;
\echo 'ALL SUPPORT ACCESS SQL TESTS PASSED'

