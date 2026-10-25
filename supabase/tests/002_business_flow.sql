-- Business-flow tests: FIFO, expiry, idempotency, discounts, payments, shifts, refunds, reports, permissions.
begin;
create temp table t (k text primary key, v text);
grant all on t to public;

create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.as_pg() returns void language plpgsql as $$ begin execute 'reset role'; end $$;
create or replace function pg_temp.fails(sql text, label text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then raise notice 'ok - % [%]', label, left(sqlerrm, 70); return; end;
  raise exception 'TEST FAILED (expected error): %', label;
end $$;
create or replace function pg_temp.expect(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'TEST FAILED: %', label; end if;
  raise notice 'ok - %', label;
end $$;

-- fixtures -------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
 ('a0000000-0000-0000-0000-000000000001', 'admin@t', '{"full_name":"Admin"}'),
 ('a0000000-0000-0000-0000-000000000002', 'cashier@t', '{"full_name":"Cashier"}'),
 ('a0000000-0000-0000-0000-000000000003', 'stock@t', '{"full_name":"Stock"}'),
 ('b0000000-0000-0000-0000-000000000001', 'cashierb@t', '{"full_name":"Cashier B"}');
insert into public.supermarkets (id, name, slug) values
 ('aaaaaaaa-0000-0000-0000-000000000001', 'Store A', 'a'), ('bbbbbbbb-0000-0000-0000-000000000001', 'Store B', 'b');
insert into public.supermarket_members (supermarket_id, user_id, role, cashier_max_discount_pct) values
 ('aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'admin', 0),
 ('aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'cashier', 10),
 ('aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'stock_staff', 0),
 ('bbbbbbbb-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'cashier', 10);

-- catalog: admin creates through RLS; others are denied
select pg_temp.as_user('a0000000-0000-0000-0000-000000000003');
select pg_temp.fails($$insert into public.products (id, supermarket_id, name) values ('c0000000-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000001', 'Nope')$$, 'stock staff cannot create products');
select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
select pg_temp.fails($$insert into public.product_prices (supermarket_id, product_id, currency, price) values ('aaaaaaaa-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'USD', 0.01)$$, 'cashier cannot set prices');
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
insert into public.products (id, supermarket_id, name, barcode) values
 ('c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Rice 1kg', '1111'),
 ('c0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Milk 1L', '2222');
update public.products set track_expiry = true where id = 'c0000000-0000-0000-0000-000000000002';
insert into public.product_prices (supermarket_id, product_id, currency, price) values
 ('aaaaaaaa-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'USD', 2.00),
 ('aaaaaaaa-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'SOS', 1200),
 ('aaaaaaaa-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'USD', 1.00),
 ('aaaaaaaa-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'SOS', 600);
select pg_temp.fails($$insert into public.products (supermarket_id, name, barcode) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Dup', '1111')$$, 'duplicate barcode within a store is rejected');
select pg_temp.fails($$insert into public.products (supermarket_id, name, category_id) values ('aaaaaaaa-0000-0000-0000-000000000001', 'X', gen_random_uuid())$$, 'foreign keys keep catalog rows inside one store');
select public.set_exchange_rate('aaaaaaaa-0000-0000-0000-000000000001', 570);
select pg_temp.fails($$select public.set_exchange_rate('aaaaaaaa-0000-0000-0000-000000000001', 0)$$, 'zero exchange rate rejected');

-- receiving: stock staff, two lots of rice at different costs, one milk lot
select pg_temp.as_user('a0000000-0000-0000-0000-000000000003');
select pg_temp.fails($$select public.receive_stock('aaaaaaaa-0000-0000-0000-000000000001', null, null, 'X', current_date, null,
  '[{"product_id":"c0000000-0000-0000-0000-000000000002","quantity":5,"unit_cost":0.5,"cost_currency":"USD"}]'::jsonb)$$, 'expiry date is required for expiry-tracked products');
select public.receive_stock('aaaaaaaa-0000-0000-0000-000000000001', null, null, 'INV-1', current_date, null,
  jsonb_build_array(
   jsonb_build_object('product_id','c0000000-0000-0000-0000-000000000001','quantity',10,'unit_cost',1.00,'cost_currency','USD','lot_number','L1'),
   jsonb_build_object('product_id','c0000000-0000-0000-0000-000000000001','quantity',10,'unit_cost',1.50,'cost_currency','USD','lot_number','L2'),
   jsonb_build_object('product_id','c0000000-0000-0000-0000-000000000002','quantity',5,'unit_cost',0.50,'cost_currency','USD','lot_number','M1','expiry_date', current_date + 10)));
select pg_temp.expect((select count(*) from public.stock_movements where movement_type = 'receipt') = 3, 'receiving writes ledger rows');
select pg_temp.fails($$update public.stock_movements set quantity = 1$$, 'stock ledger cannot be edited');
select pg_temp.fails($$select public.adjust_lot((select id from public.inventory_lots limit 1), 1, 'x', false)$$, 'stock staff cannot adjust stock');
select pg_temp.as_pg();
insert into public.inventory_lots (supermarket_id, product_id, lot_number, received_at, expiry_date, quantity_received, quantity_remaining, unit_cost, cost_currency)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'OLD', now() - interval '60 days', current_date - 1, 100, 100, 0.10, 'USD');

-- shifts and sales ------------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
select pg_temp.fails($$select public.checkout('aaaaaaaa-0000-0000-0000-000000000001', gen_random_uuid(), 'USD', '[]', '[]', 'key-no-shift')$$, 'checkout requires an open shift');
insert into t select 'shift', public.open_shift('aaaaaaaa-0000-0000-0000-000000000001', 20, 0)::text;
select pg_temp.fails($$select public.open_shift('aaaaaaaa-0000-0000-0000-000000000001', 0, 0)$$, 'only one open shift per cashier');

insert into t select 'sale1', public.checkout('aaaaaaaa-0000-0000-0000-000000000001', (select v::uuid from t where k = 'shift'), 'USD',
  '[{"product_id":"c0000000-0000-0000-0000-000000000001","quantity":12,"price":0.01}]',
  '[{"method":"cash","amount":24.00,"currency":"USD"}]', 'key-sale-0001')::text;
select pg_temp.expect((select (v::jsonb -> 'sale' ->> 'total')::numeric from t where k = 'sale1') = 24.00, 'server prices the sale (client price ignored)');
select pg_temp.as_pg();
select pg_temp.expect((select sum(cost_in_sale_currency) from public.sale_item_lot_allocations) = 13.00, 'FIFO cost: 10 @1.00 + 2 @1.50 = 13.00');
select pg_temp.expect((select count(*) from public.sale_item_lot_allocations) = 2, 'allocation rows record each lot consumed');
select pg_temp.expect((select quantity_remaining from public.inventory_lots where lot_number = 'L1') = 0
  and (select quantity_remaining from public.inventory_lots where lot_number = 'L2') = 8, 'oldest lot is drained first');
select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');

-- idempotency
insert into t select 'sale1b', public.checkout('aaaaaaaa-0000-0000-0000-000000000001', (select v::uuid from t where k = 'shift'), 'USD',
  '[{"product_id":"c0000000-0000-0000-0000-000000000001","quantity":12}]', '[{"method":"cash","amount":24.00,"currency":"USD"}]', 'key-sale-0001')::text;
select pg_temp.expect((select v::jsonb -> 'sale' ->> 'receipt_number' from t where k = 'sale1') = (select v::jsonb -> 'sale' ->> 'receipt_number' from t where k = 'sale1b'), 'retry with same idempotency key returns the same receipt');
select pg_temp.expect((select count(*) from public.sales) = 1, 'retry did not create a second sale');

-- expiry exclusion (milk: 5 valid, 100 expired)
insert into t select 'sale2', public.checkout('aaaaaaaa-0000-0000-0000-000000000001', (select v::uuid from t where k = 'shift'), 'USD',
  '[{"product_id":"c0000000-0000-0000-0000-000000000002","quantity":5}]', '[{"method":"evc_plus","amount":5.00,"currency":"USD","reference":"EVC123"}]', 'key-sale-0002')::text;
select pg_temp.fails($$select public.checkout('aaaaaaaa-0000-0000-0000-000000000001', (select v::uuid from t where k = 'shift'), 'USD',
  '[{"product_id":"c0000000-0000-0000-0000-000000000002","quantity":1}]', '[{"method":"cash","amount":1.00,"currency":"USD"}]', 'key-sale-0003')$$, 'expired lots are never sold');

-- discount limit (10%), payment exactness, rollback
select pg_temp.fails($$select public.checkout('aaaaaaaa-0000-0000-0000-000000000001', (select v::uuid from t where k = 'shift'), 'USD',
  '[{"product_id":"c0000000-0000-0000-0000-000000000001","quantity":1,"discount_pct":15}]', '[{"method":"cash","amount":1.70,"currency":"USD"}]', 'key-sale-0004')$$, 'discount above the configured limit is rejected by the database');
select pg_temp.fails($$select public.checkout('aaaaaaaa-0000-0000-0000-000000000001', (select v::uuid from t where k = 'shift'), 'USD',
  '[{"product_id":"c0000000-0000-0000-0000-000000000001","quantity":1,"discount_pct":10}]', '[{"method":"cash","amount":1.00,"currency":"USD"}]', 'key-sale-0005')$$, 'underpayment rejected');
select pg_temp.fails($$select public.checkout('aaaaaaaa-0000-0000-0000-000000000001', (select v::uuid from t where k = 'shift'), 'USD',
  '[{"product_id":"c0000000-0000-0000-0000-000000000001","quantity":1,"discount_pct":10}]', '[{"method":"cash","amount":2.00,"currency":"USD"}]', 'key-sale-0006')$$, 'overpayment rejected');
select pg_temp.fails($$select public.checkout('aaaaaaaa-0000-0000-0000-000000000001', (select v::uuid from t where k = 'shift'), 'USD',
  '[{"product_id":"c0000000-0000-0000-0000-000000000001","quantity":1000}]', '[{"method":"cash","amount":2000.00,"currency":"USD"}]', 'key-sale-0007')$$, 'overselling rejected');
select pg_temp.as_pg();
select pg_temp.expect((select count(*) from public.sales) = 2 and (select quantity_remaining from public.inventory_lots where lot_number = 'L2') = 8, 'failed checkouts rolled back completely');
select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
insert into t select 'sale3', public.checkout('aaaaaaaa-0000-0000-0000-000000000001', (select v::uuid from t where k = 'shift'), 'USD',
  '[{"product_id":"c0000000-0000-0000-0000-000000000001","quantity":1,"discount_pct":10}]', '[{"method":"cash","amount":1.80,"currency":"USD"}]', 'key-sale-0008')::text;
select pg_temp.expect((select (v::jsonb -> 'sale' ->> 'total')::numeric from t where k = 'sale3') = 1.80, 'discount within limit applied (2.00 - 10%)');

-- split multi-currency payment: SOS sale, USD 1.00 (=570 SOS at rate 570) + SOS 630
insert into t select 'sale4', public.checkout('aaaaaaaa-0000-0000-0000-000000000001', (select v::uuid from t where k = 'shift'), 'SOS',
  '[{"product_id":"c0000000-0000-0000-0000-000000000001","quantity":1}]',
  '[{"method":"evc_plus","amount":1.00,"currency":"USD"},{"method":"cash","amount":630,"currency":"SOS"}]', 'key-sale-0009')::text;
select pg_temp.expect((select (v::jsonb -> 'sale' ->> 'total')::numeric from t where k = 'sale4') = 1200, 'SOS sale uses the independent SOS price');
select pg_temp.expect((select (p ->> 'exchange_rate')::numeric from jsonb_array_elements((select v::jsonb -> 'payments' from t where k = 'sale4')) p where p ->> 'currency' = 'USD') = 570, 'exchange rate used is stored on the payment');
select pg_temp.fails($$select public.checkout('aaaaaaaa-0000-0000-0000-000000000001', (select v::uuid from t where k = 'shift'), 'SOS',
  '[{"product_id":"c0000000-0000-0000-0000-000000000001","quantity":1}]', '[{"method":"cash","amount":1000,"currency":"SOS"}]', 'key-sale-0010')$$, 'split payments must still sum exactly');
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
select public.set_exchange_rate('aaaaaaaa-0000-0000-0000-000000000001', 600);
select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
select pg_temp.expect((select (p ->> 'exchange_rate')::numeric from jsonb_array_elements(public.get_receipt((select (v::jsonb -> 'sale' ->> 'id')::uuid from t where k = 'sale4')) -> 'payments') p where p ->> 'currency' = 'USD') = 570, 'changing the rate does not rewrite historical receipts');

-- cashier visibility
select pg_temp.fails($$select cost_total from public.sale_items$$, 'cashier cannot read FIFO cost');
select pg_temp.expect((select count(*) from public.sale_item_lot_allocations) = 0, 'cashier cannot read allocations');
select pg_temp.expect((select count(*) from public.inventory_lots) = 0, 'cashier cannot read lots');
select pg_temp.fails($$select * from public.report_profit('aaaaaaaa-0000-0000-0000-000000000001', current_date - 1, current_date + 1)$$, 'cashier cannot run profit reports');
select pg_temp.expect((select count(*) from public.pos_catalog('aaaaaaaa-0000-0000-0000-000000000001')) = 2, 'POS catalog available to cashier');
select pg_temp.expect((select available from public.pos_catalog('aaaaaaaa-0000-0000-0000-000000000001') where name = 'Rice 1kg') = 6, 'POS shows live availability');
select pg_temp.as_user('a0000000-0000-0000-0000-000000000003');
select pg_temp.expect((select count(*) from public.sales) = 0, 'stock staff cannot read sales');
select pg_temp.fails($$select public.checkout('aaaaaaaa-0000-0000-0000-000000000001', (select v::uuid from t where k = 'shift'), 'USD', '[]', '[]', 'key-stock-1')$$, 'stock staff cannot sell');
select pg_temp.as_user('b0000000-0000-0000-0000-000000000001');
select pg_temp.fails($$select public.checkout('aaaaaaaa-0000-0000-0000-000000000001', (select v::uuid from t where k = 'shift'), 'USD',
  '[{"product_id":"c0000000-0000-0000-0000-000000000001","quantity":1}]', '[{"method":"cash","amount":2.00,"currency":"USD"}]', 'key-cross-1')$$, 'cashier of store B cannot sell in store A');
select pg_temp.expect((select count(*) from public.sales) = 0, 'store B cashier sees no store A sales');

-- refunds -----------------------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
select pg_temp.fails($$select public.refund_sale((select (v::jsonb -> 'sale' ->> 'id')::uuid from t where k = 'sale1'), '[]', 'x', 'cash')$$, 'cashier cannot approve refunds');
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
select pg_temp.fails($$select public.refund_sale((select (v::jsonb -> 'sale' ->> 'id')::uuid from t where k = 'sale1'),
  jsonb_build_array(jsonb_build_object('sale_item_id', (select id from public.sale_items where sale_id = (select (v::jsonb -> 'sale' ->> 'id')::uuid from t where k = 'sale1')), 'quantity', 13, 'disposition', 'restock')), 'bad', 'cash')$$, 'refund quantity above sold quantity rejected');
select pg_temp.fails($$select public.refund_sale((select (v::jsonb -> 'sale' ->> 'id')::uuid from t where k = 'sale1'),
  jsonb_build_array(jsonb_build_object('sale_item_id', (select id from public.sale_items where sale_id = (select (v::jsonb -> 'sale' ->> 'id')::uuid from t where k = 'sale1')), 'quantity', 1, 'disposition', 'restock')), '', 'cash')$$, 'refund requires a reason');
select public.refund_sale((select (v::jsonb -> 'sale' ->> 'id')::uuid from t where k = 'sale1'),
  jsonb_build_array(jsonb_build_object('sale_item_id', (select id from public.sale_items where sale_id = (select (v::jsonb -> 'sale' ->> 'id')::uuid from t where k = 'sale1')), 'quantity', 2, 'disposition', 'restock')), 'Customer returned unopened', 'cash');
select pg_temp.expect((select quantity_remaining from public.inventory_lots where lot_number = 'L2') = 6 + 2, 'restocked goods return to the lot they came from (6 + 2)');
select pg_temp.expect((select status from public.sales where id = (select (v::jsonb -> 'sale' ->> 'id')::uuid from t where k = 'sale1')) = 'partially_refunded', 'sale marked partially refunded, original kept');
select pg_temp.fails($$select public.refund_sale((select (v::jsonb -> 'sale' ->> 'id')::uuid from t where k = 'sale1'),
  jsonb_build_array(jsonb_build_object('sale_item_id', (select id from public.sale_items where sale_id = (select (v::jsonb -> 'sale' ->> 'id')::uuid from t where k = 'sale1')), 'quantity', 11, 'disposition', 'restock')), 'too many', 'cash')$$, 'cannot exceed remaining refundable quantity');
select public.void_sale((select (v::jsonb -> 'sale' ->> 'id')::uuid from t where k = 'sale2'), 'Entered by mistake', 'evc_plus');
select pg_temp.expect((select status from public.sales where id = (select (v::jsonb -> 'sale' ->> 'id')::uuid from t where k = 'sale2')) = 'voided', 'void keeps the sale and marks it voided');
select pg_temp.fails($$select public.void_sale((select (v::jsonb -> 'sale' ->> 'id')::uuid from t where k = 'sale2'), 'again', 'cash')$$, 'a voided sale cannot be voided twice');
select pg_temp.expect((select available from public.pos_catalog('aaaaaaaa-0000-0000-0000-000000000001') where name = 'Milk 1L') = 5, 'voided goods are restocked');

-- adjustments and write-offs
select pg_temp.fails($$select public.adjust_lot((select id from public.inventory_lots where lot_number = 'OLD'), 5, '', true)$$, 'write-off requires a reason');
select public.adjust_lot((select id from public.inventory_lots where lot_number = 'OLD'), 100, 'Expired, discarded', true);
select pg_temp.expect((select quantity_remaining from public.inventory_lots where lot_number = 'OLD') = 0, 'expired lot written off with audit');
select pg_temp.expect(exists (select 1 from public.audit_logs where action = 'stock.write_off'), 'write-off is audited');

-- reports -----------------------------------------------------------------------------
insert into public.expenses (supermarket_id, category, description, amount, currency) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Rent', 'Shop rent', 3.00, 'USD');
select pg_temp.expect((select net_sales from public.report_profit('aaaaaaaa-0000-0000-0000-000000000001', current_date - 1, current_date + 1) where currency = 'USD') = 24.00 + 5.00 + 1.80 - 4.00 - 5.00 , 'USD net sales = sales - refunds - void');
select pg_temp.expect((select cogs from public.report_profit('aaaaaaaa-0000-0000-0000-000000000001', current_date - 1, current_date + 1) where currency = 'USD') = 13.00 + 2.50 + 1.50 - 3.00 - 2.50, 'COGS comes from FIFO allocations, net of restocked returns');
select pg_temp.expect((select operating_result from public.report_profit('aaaaaaaa-0000-0000-0000-000000000001', current_date - 1, current_date + 1) where currency = 'USD') = (24.00 + 1.80 - 4.00) - (13.00 + 1.50 - 3.00) - 3.00, 'operating result = gross profit - expenses');
select pg_temp.expect((select net_sales from public.report_profit('aaaaaaaa-0000-0000-0000-000000000001', current_date - 1, current_date + 1) where currency = 'SOS') = 1200
  and (select gross_profit from public.report_profit('aaaaaaaa-0000-0000-0000-000000000001', current_date - 1, current_date + 1) where currency = 'SOS') = 1200 - 855, 'currencies are reported separately (SOS: cost converted at the sale-time rate)');
select pg_temp.expect((select sum(amount) from public.report_sales_breakdown('aaaaaaaa-0000-0000-0000-000000000001', current_date - 1, current_date + 1, 'payment_method') where currency = 'USD') = 24.00 + 5.00 + 1.80, 'payment-method breakdown');

-- shift close ---------------------------------------------------------------------------
select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
select pg_temp.expect((public.get_shift_summary((select v::uuid from t where k = 'shift')) ->> 'expected_usd')::numeric = 20 + 24.00 + 1.80 - 4.00, 'expected cash = opening + cash sales - cash refunds (mobile money excluded)');
select pg_temp.expect((public.get_shift_summary((select v::uuid from t where k = 'shift')) ->> 'expected_sos')::numeric = 630, 'expected SOS cash excludes the USD mobile-money part');
select public.close_shift((select v::uuid from t where k = 'shift'), 41.80, 600, 'ok');
select pg_temp.expect((select difference_sos from public.cashier_shifts) = -30 and (select difference_usd from public.cashier_shifts) = 0, 'cash difference computed by the backend');
select pg_temp.fails($$select public.checkout('aaaaaaaa-0000-0000-0000-000000000001', (select v::uuid from t where k = 'shift'), 'USD',
  '[{"product_id":"c0000000-0000-0000-0000-000000000001","quantity":1}]', '[{"method":"cash","amount":2.00,"currency":"USD"}]', 'key-closed-1')$$, 'closed shift cannot take sales');
select pg_temp.fails($$select public.close_shift((select v::uuid from t where k = 'shift'), 0, 0, null)$$, 'a shift cannot be closed twice');
select pg_temp.fails($$update public.payments set amount = 1$$, 'payments cannot be edited');

rollback;
\echo 'ALL BUSINESS FLOW TESTS PASSED'
