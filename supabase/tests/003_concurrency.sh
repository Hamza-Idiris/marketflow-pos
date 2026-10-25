#!/bin/bash
# Two cashiers sell 6 of the same 10 units at the same moment: exactly one may succeed.
# Usage: DB_URL=postgresql://... ./supabase/tests/003_concurrency.sh   (uses throw-away fixtures; run on a LOCAL db only)
set -e
DB_URL=${DB_URL:?set DB_URL to a local database}
psql "$DB_URL" -q -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users (id, email, raw_user_meta_data) values
 ('d0000000-0000-0000-0000-000000000001','c1@conc','{"full_name":"C1"}'),('d0000000-0000-0000-0000-000000000002','c2@conc','{"full_name":"C2"}'),
 ('d0000000-0000-0000-0000-000000000003','a@conc','{"full_name":"A"}');
insert into public.supermarkets (id, name, slug) values ('dddddddd-0000-0000-0000-000000000001','Conc','conc');
insert into public.supermarket_members (supermarket_id,user_id,role) values
 ('dddddddd-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','cashier'),
 ('dddddddd-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002','cashier'),
 ('dddddddd-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000003','stock_staff');
insert into public.products (id, supermarket_id, name) values ('e0000000-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','Sugar');
insert into public.product_prices (supermarket_id, product_id, currency, price) values ('dddddddd-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','USD',1);
insert into public.inventory_lots (supermarket_id, product_id, quantity_received, quantity_remaining, unit_cost, cost_currency)
 values ('dddddddd-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',10,10,0.5,'USD');
insert into public.cashier_shifts (id, supermarket_id, cashier_id) values
 ('f0000000-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001'),
 ('f0000000-0000-0000-0000-000000000002','dddddddd-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002');
SQL
sell() { # $1 user, $2 shift, $3 key
psql "$DB_URL" -q -t -A <<SQL 2>&1 | grep -E "OK|ERROR" | head -1
select set_config('request.jwt.claim.sub','$1',false);
set role authenticated;
select 'OK ' || ((public.checkout('dddddddd-0000-0000-0000-000000000001','$2','USD',
 '[{"product_id":"e0000000-0000-0000-0000-000000000001","quantity":6}]','[{"method":"cash","amount":6.00,"currency":"USD"}]','$3')) -> 'sale' ->> 'receipt_number');
SQL
}
sell d0000000-0000-0000-0000-000000000001 f0000000-0000-0000-0000-000000000001 conc-key-0001 > /tmp/c1.out &
sell d0000000-0000-0000-0000-000000000002 f0000000-0000-0000-0000-000000000002 conc-key-0002 > /tmp/c2.out &
wait
cat /tmp/c1.out /tmp/c2.out
ok=$(cat /tmp/c1.out /tmp/c2.out | grep -c '^OK')
left=$(psql "$DB_URL" -q -t -A -c "select quantity_remaining from public.inventory_lots where product_id='e0000000-0000-0000-0000-000000000001'")
if [ "$ok" = "1" ] && [ "$left" = "4.000" ]; then echo "CONCURRENCY TEST PASSED (1 sale succeeded, 4 units left)"; else echo "CONCURRENCY TEST FAILED ok=$ok left=$left"; exit 1; fi
