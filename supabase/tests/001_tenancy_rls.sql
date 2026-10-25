-- Run against a local Supabase database:  psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/001_tenancy_rls.sql
-- Everything runs in one transaction and is rolled back at the end.
begin;

create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
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
    return;
  end;
  raise exception 'TEST FAILED (expected error): %', label;
end $$;

create or replace function pg_temp.expect(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'TEST FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;

-- fixtures (as postgres) -----------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'super@t.local',   '{"full_name":"Super"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin-a@t.local', '{"full_name":"Admin A"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'cashier-a@t.local','{"full_name":"Cashier A"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'admin-b@t.local', '{"full_name":"Admin B"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'stock-a@t.local', '{"full_name":"Stock A"}');
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-0000000000a1';
insert into public.supermarkets (id, name, slug) values
  ('11111111-1111-1111-1111-111111111111', 'Store A', 'store-a'),
  ('22222222-2222-2222-2222-222222222222', 'Store B', 'store-b');
insert into public.supermarket_members (supermarket_id, user_id, role) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a2', 'admin'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a3', 'cashier'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000c1', 'stock_staff'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000b2', 'admin');

select pg_temp.expect((select count(*) from public.profiles) = 5, 'trigger created a profile per auth user');

-- cross-store isolation --------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.expect((select count(*) from public.supermarkets) = 1, 'admin A sees only store A');
select pg_temp.expect(not exists (select 1 from public.supermarkets where slug = 'store-b'), 'admin A cannot see store B');
select pg_temp.expect((select count(*) from public.supermarket_members) = 3, 'admin A sees only store A members');
select pg_temp.expect(not exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'), 'admin A cannot read admin B profile');
select pg_temp.expect(exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-0000000000a3'), 'admin A can read own employee profile');

-- cashier limits ---------------------------------------------------------------
select pg_temp.as_admin();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select pg_temp.expect((select count(*) from public.supermarkets) = 1, 'cashier sees own store only');
select pg_temp.expect((select count(*) from public.supermarket_members) = 1, 'cashier sees only own membership row');
select pg_temp.expect((select count(*) from public.audit_logs) = 0, 'cashier cannot read audit logs');
select pg_temp.expect_error($$update public.profiles set is_super_admin = true where id = auth.uid()$$, 'cashier cannot self-promote to super admin (column grant)');
select pg_temp.expect_error($$update public.profiles set is_active = true where id = auth.uid()$$, 'cashier cannot touch is_active');
select pg_temp.expect_error($$insert into public.supermarket_members (supermarket_id, user_id, role) values ('11111111-1111-1111-1111-111111111111', auth.uid(), 'admin')$$, 'cashier cannot insert membership directly');
select pg_temp.expect_error($$select public.upsert_store_member('11111111-1111-1111-1111-111111111111', auth.uid(), 'admin', 100)$$, 'cashier cannot grant self admin via RPC');
select pg_temp.expect_error($$select public.create_supermarket('Evil', 'evil')$$, 'cashier cannot create supermarkets');
select pg_temp.expect_error($$insert into public.audit_logs (action, entity_type) values ('x','y')$$, 'clients cannot write audit logs');
update public.profiles set full_name = 'Renamed Cashier' where id = auth.uid();
select pg_temp.expect((select full_name from public.profiles where id = auth.uid()) = 'Renamed Cashier', 'user can update own name');

-- admin rules ------------------------------------------------------------------
select pg_temp.as_admin();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_error($$select public.upsert_store_member('11111111-1111-1111-1111-111111111111', auth.uid(), 'admin', 0)$$, 'admin cannot edit own membership');
select pg_temp.expect_error($$select public.upsert_store_member('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000a3', 'cashier', 5)$$, 'admin A cannot manage store B');
select pg_temp.expect_error($$select public.upsert_store_member('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a3', 'cashier', 150)$$, 'discount limit above 100 rejected');
select public.upsert_store_member('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000a3', 'cashier', 7.5);
select pg_temp.expect((select cashier_max_discount_pct from public.supermarket_members where user_id = '00000000-0000-0000-0000-0000000000a3') = 7.5, 'admin sets cashier discount limit');
select pg_temp.expect((select count(*) from public.audit_logs) >= 1, 'admin can read store audit log');
select pg_temp.expect_error($$select public.set_supermarket_active('11111111-1111-1111-1111-111111111111', false)$$, 'admin cannot suspend a store');

-- super admin -------------------------------------------------------------------
select pg_temp.as_admin();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect((select count(*) from public.supermarkets) = 2, 'super admin sees all stores');
select public.create_supermarket('Store C', 'store-c');
select pg_temp.expect((select count(*) from public.supermarkets) = 3, 'super admin creates a store');
select public.set_supermarket_active('11111111-1111-1111-1111-111111111111', false);

-- suspended store locks its staff out ---------------------------------------------
select pg_temp.as_admin();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select pg_temp.expect((select count(*) from public.supermarkets) = 0, 'cashier of suspended store sees nothing');
select pg_temp.as_admin();
update public.supermarkets set is_active = true where id = '11111111-1111-1111-1111-111111111111';

-- deactivated user locked out --------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select public.set_profile_active('00000000-0000-0000-0000-0000000000a3', false);
select pg_temp.as_admin();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select pg_temp.expect((select count(*) from public.supermarkets) = 0, 'deactivated cashier loses store access');
update public.profiles set full_name = 'Hacked' where id = auth.uid();
select pg_temp.as_admin();
select pg_temp.expect((select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000a3') = 'Renamed Cashier', 'deactivated cashier cannot update profile');

-- anon ---------------------------------------------------------------------------------
select pg_temp.as_admin();
set local role anon;
select pg_temp.expect_error($$select * from public.supermarkets$$, 'anon cannot read tenant tables');

rollback;
\echo 'ALL TENANCY TESTS PASSED'
