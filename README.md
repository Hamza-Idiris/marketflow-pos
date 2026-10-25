# Supermarket POS (multi-store)

React + TypeScript + Vite + Tailwind on Supabase (Postgres, Auth, RLS, RPC, Storage, Edge Functions).
**Status: all 8 phases built.** See "Verification status" below for exactly what has and has not been tested.

## Modules
Auth and password reset · Super admin (supermarkets, administrators, suspend/activate, platform reports, audit log) ·
Employees and roles (cashier discount limits) · Categories, units, products, prices (USD and SOS), image upload ·
Suppliers, purchase orders (draft, ordered, partial/complete receiving, cancel) · Stock receiving into FIFO lots with expiry ·
Inventory (filters, lots, movements, adjustments and write-offs) · Cashier shifts (cash in/out, close with expected-cash check) ·
POS (barcode scanner input, categories, split multi-currency payments, receipts) · Sales history, refunds, voids ·
Expenses · Reports with CSV export and charts · Barcode labels · Settings and exchange rate.

## Setup
1. `cp .env.example .env` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
2. `npm install`
3. Database (local): `supabase start && supabase db reset` (applies `supabase/migrations/*` then `seed.sql`).
   Hosted: `supabase link --project-ref <ref> && supabase db push`. **Never run `seed.sql` in production.**
4. Edge function (employee invitations): `supabase functions deploy invite-user` and set the secret `SITE_URL` (your app's URL).
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically; the service-role key never reaches the browser.
5. `npm run dev`

### Local demo users (password `Passw0rd!demo`)
`super@demo.local` (super admin) · `admin@demo.local` · `stock@demo.local` · `cashier@demo.local` (5% discount limit) · `admin-b@demo.local` (second store).
The demo store has 5 products with stock and an exchange rate of 570 SOS per USD.

### First super admin in production
Create a user in the Supabase dashboard, then in the SQL editor:
```sql
update public.profiles set is_super_admin = true where id = (select id from auth.users where email = 'owner@example.com');
```

## How the important rules are enforced
- **Tenant isolation:** every table has `supermarket_id`, RLS, and composite foreign keys so rows can never point into another store.
- **Checkout** (`checkout()` RPC) runs in one transaction: server-side prices, discount limit, row-locked FIFO allocation of non-expired lots,
  exact payment match, unique receipt number, and an idempotency key so retries cannot double-charge. The browser never sends prices, costs or totals.
- **Currencies:** USD and SOS have independent prices. Exchange-rate convention is SOS per 1 USD. Each payment stores the rate used; history is never rewritten.
  Reports show each currency separately and never add them together.
- **Cost of goods sold** comes from the exact lots each sale consumed (`sale_item_lot_allocations`), not from a current cost.
- **Mobile money** (EVC Plus, Sahal, Zaad) is recorded manually and labelled "not verified". Provider verification would be a separate webhook integration.
- **Receipts:** printing is only recorded as *requested*; browsers cannot confirm paper came out.
- **Immutability:** stock movements, payments, sale items (cost snapshot), refunds and exchange rates cannot be edited or deleted.
- Cashiers cannot read FIFO costs, lots, or other cashiers' sales; stock staff cannot read sales, expenses or reports.

## Verification status
Run here, all passing:
- `npm run typecheck`, `npm run lint`, `npm test` (20 unit tests), `npm run build`.
- SQL test suites on **plain PostgreSQL 16 with a minimal stub of Supabase's `auth` schema**: tenancy/RLS (`001`), business flow (`002`: FIFO across lots, expiry exclusion,
  idempotency, discount limit, exact/split payments, rollback, shifts, refunds, voids, reports, cost privacy), and a **real two-session concurrency test** (`003`:
  two cashiers selling the same stock at once, exactly one succeeds).

**Not** run here (please do on first setup): the app in a browser against a real Supabase project; Supabase Storage policies and image upload; the `invite-user`
Edge Function (needs Supabase's Auth service); email delivery; the seed's `auth.users`/`auth.identities` inserts (the catalog half was tested, the user half was not);
real USB scanners and thermal printers. The React screens are type-checked and linted but have no automated browser tests.

## Checks
```
npm run typecheck && npm run lint && npm test
DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:db   # local database only
```

## Deployment
- Frontend: any static host (Vercel, Netlify, Cloudflare Pages). Build `npm run build`, output `dist`, set the two `VITE_` variables, add an SPA fallback to `index.html`.
- Supabase: Auth > URL Configuration (site URL and redirect `https://your-domain/reset-password`), configure SMTP, `supabase db push`, deploy the function.

## Integrations that still need real credentials
SMTP email for invitations/resets (Supabase's built-in sender is rate-limited) · EVC Plus / Sahal / Zaad payment verification APIs · thermal printer drivers if you want silent printing.

## Known limitations
- Payments must equal the total exactly (no change or credit sales). For mixed-currency splits, rounding to whole SOS / cents can make an exact match impossible; the cashier adjusts the last amount.
- Stock adjustments can only remove units from a lot; to add stock, receive it.
- Refunds and voids are admin-only; a cash refund reduces expected cash only if the sale's shift is still open.
- Nothing prevents removing a store's last admin (a super admin can repair it). No accounts-payable module; supplier payments are not tracked.
- Product images are public URLs in a public bucket.
- Reports use the Africa/Mogadishu calendar day. The UI bundle is ~1 MB (not code-split).
