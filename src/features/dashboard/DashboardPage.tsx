import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { Alert, Card, Skeleton } from '@/components/ui';
import { Badge, ErrorState } from '@/components/kit';
import { addDaysISO, formatDateTime, formatMoney, METHOD_LABEL, todayISO } from '@/lib/format';
import { usePeriods, useProfit } from '@/features/reports/ReportsPage';
import { usePlatform } from '@/features/reports/PlatformReportsPage';
import { useExpiryDays } from '@/features/inventory/InventoryPage';
import { useOpenShift } from '@/features/shifts/useShift';
import { StoreAccessBanner } from '@/features/supermarkets/StoreAccessBanner';
import type { Currency } from '@/types/database';

function Stat({ label, value, hint, loading }: { label: string; value: string; hint?: string; loading?: boolean }) {
  return <Card><p className="text-sm text-ink-500">{label}</p>{loading ? <Skeleton className="mt-2 h-8 w-24" /> : <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>}{hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}</Card>;
}
const CURS: Currency[] = ['USD', 'SOS'];

function PlatformDashboard() {
  const q = usePlatform();
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const stores = new Map<string, { name: string; active: boolean }>(); q.data?.forEach((r) => stores.set(r.store_id, { name: r.store_name, active: r.is_active }));
  const active = [...stores.values()].filter((s) => s.active).length;
  const totalBy = (c: Currency) => (q.data ?? []).filter((r) => r.currency === c).reduce((s, r) => s + r.total, 0);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Registered supermarkets" value={String(stores.size)} loading={q.isLoading} /><Stat label="Active" value={String(active)} loading={q.isLoading} /><Stat label="Suspended" value={String(stores.size - active)} loading={q.isLoading} />
        <Stat label="Sales, last 30 days" value={formatMoney(totalBy('USD'), 'USD')} hint={`and ${formatMoney(totalBy('SOS'), 'SOS')}`} loading={q.isLoading} />
      </div>
      <Card><h2 className="mb-3 font-semibold">Store performance (USD sales, last 30 days)</h2>
        {q.isLoading ? <Skeleton className="h-56 w-full" /> : <div className="h-56"><ResponsiveContainer><BarChart data={(q.data ?? []).filter((r) => r.currency === 'USD').map((r) => ({ name: r.store_name, Sales: r.total }))}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={12} /><YAxis fontSize={12} width={60} /><Tooltip formatter={(v) => formatMoney(Number(v), 'USD')} /><Bar dataKey="Sales" fill="#2563eb" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>}</Card>
      <p className="text-sm"><Link className="font-medium text-brand-600" to="/supermarkets">Manage supermarkets</Link> · <Link className="font-medium text-brand-600" to="/platform-reports">Platform reports</Link> · <Link className="font-medium text-brand-600" to="/audit">Audit log</Link></p>
    </div>
  );
}

function AdminDashboard({ storeId }: { storeId: string }) {
  const today = todayISO();
  const profit = useProfit(storeId, today, today);
  const trend = usePeriods(storeId, addDaysISO(today, -13), today, 'day');
  const stock = useQuery({ queryKey: ['inventory', 'alerts', storeId], queryFn: async () => { const { data, error } = await supabase.from('inventory_overview').select('name, available, min_stock, next_expiry').eq('supermarket_id', storeId).eq('is_active', true); if (error) throw error; return data as Array<{ name: string; available: number; min_stock: number; next_expiry: string | null }>; } });
  const recent = useQuery({ queryKey: ['sales', 'recent', storeId], queryFn: async () => { const { data, error } = await supabase.from('sales').select('id, receipt_number, total, currency, created_at, status, cashier:profiles(full_name)').eq('supermarket_id', storeId).order('created_at', { ascending: false }).limit(6); if (error) throw error; return data as unknown as Array<{ id: string; receipt_number: string; total: number; currency: Currency; created_at: string; status: string; cashier: { full_name: string } | null }>; } });
  const purchases = useQuery({ queryKey: ['purchase-orders', 'recent', storeId], queryFn: async () => { const { data, error } = await supabase.from('purchase_orders').select('id, reference, status, created_at, supplier:suppliers(name)').eq('supermarket_id', storeId).order('created_at', { ascending: false }).limit(5); if (error) throw error; return data as unknown as Array<{ id: string; reference: string | null; status: string; created_at: string; supplier: { name: string } | null }>; } });
  const pay = useQuery({ queryKey: ['report', 'pay-today', storeId, today], queryFn: async () => rpc<Array<{ label: string; currency: Currency; quantity: number; amount: number }>>('report_sales_breakdown', { p_store: storeId, p_from: today, p_to: today, p_dim: 'payment_method' }) });
  const cashiers = useQuery({ queryKey: ['report', 'cashier-today', storeId, today], queryFn: async () => rpc<Array<{ label: string; currency: Currency; quantity: number; amount: number }>>('report_sales_breakdown', { p_store: storeId, p_from: today, p_to: today, p_dim: 'cashier' }) });
  const todayRows = (trend.data ?? []).filter((p) => p.period === today);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CURS.map((c) => {
          const row = todayRows.find((r) => r.currency === c);
          const p = profit.data?.find((r) => r.currency === c);
          return (
            <Card key={c}>
              <p className="text-sm text-ink-500">Today&apos;s sales ({c})</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(row?.net_sales ?? 0, c)}</p>
              <p className="mt-1 text-xs text-ink-500">Gross profit: {formatMoney(p?.gross_profit ?? 0, c)}</p>
            </Card>
          );
        })}
        <Card><p className="text-sm text-ink-500">Transactions today</p><p className="mt-1 text-2xl font-semibold tabular-nums">{todayRows.reduce((s, r) => s + Number(r.sales_count), 0)}</p></Card>
        <Card><p className="text-sm text-ink-500">Low stock products</p><p className="mt-1 text-2xl font-semibold tabular-nums">{(stock.data ?? []).filter((p) => Number(p.available) <= Number(p.min_stock)).length}</p></Card>
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">Net sales, last 14 days (USD)</h2>
        {trend.isLoading ? <Skeleton className="h-56 w-full" /> : (
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={(trend.data ?? []).filter((r) => r.currency === 'USD')}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="period" fontSize={12} tickFormatter={(v) => String(v).slice(5)} />
                <YAxis fontSize={12} width={50} />
                <Tooltip formatter={(v) => formatMoney(Number(v), 'USD')} />
                <Bar dataKey="net_sales" fill="#16a34a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Recent sales</h2>
          {recent.isLoading ? <Skeleton className="h-40 w-full" /> : recent.data!.length === 0 ? <p className="text-sm text-ink-500">No sales yet.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {recent.data!.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2">
                  <div>
                    <span className="font-medium">{s.receipt_number}</span>
                    <span className="ml-2 text-xs text-ink-500">{s.cashier?.full_name ?? 'Unknown'} · {formatDateTime(s.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={s.status === 'completed' ? 'green' : s.status === 'voided' ? 'red' : 'amber'}>{s.status}</Badge>
                    <span className="font-semibold tabular-nums">{formatMoney(s.total, s.currency)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Today by payment method</h2>
          {pay.isLoading ? <Skeleton className="h-40 w-full" /> : (pay.data ?? []).length === 0 ? <p className="text-sm text-ink-500">No payments yet today.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {pay.data!.map((p) => (
                <li key={`${p.label}-${p.currency}`} className="flex justify-between py-2">
                  <span>{METHOD_LABEL[p.label as keyof typeof METHOD_LABEL] ?? p.label} <span className="text-xs text-ink-500">({p.quantity} sales)</span></span>
                  <span className="font-semibold tabular-nums">{formatMoney(p.amount, p.currency)}</span>
                </li>
              ))}
            </ul>
          )}
          <h2 className="mb-3 mt-5 font-semibold">Today by cashier</h2>
          {cashiers.isLoading ? <Skeleton className="h-24 w-full" /> : (cashiers.data ?? []).length === 0 ? <p className="text-sm text-ink-500">No cashier activity yet.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {cashiers.data!.map((c) => (
                <li key={`${c.label}-${c.currency}`} className="flex justify-between py-1.5">
                  <span>{c.label} <span className="text-xs text-ink-500">({c.quantity} sales)</span></span>
                  <span className="font-semibold tabular-nums">{formatMoney(c.amount, c.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">Recent purchase orders</h2>
        {purchases.isLoading ? <Skeleton className="h-32 w-full" /> : purchases.data!.length === 0 ? <p className="text-sm text-ink-500">No purchase orders recorded.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {purchases.data!.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <div><span className="font-medium">{p.reference || 'PO'}</span><span className="ml-2 text-xs text-ink-500">{p.supplier?.name ?? 'No supplier'} · {formatDateTime(p.created_at)}</span></div>
                <Badge tone={p.status === 'received' ? 'green' : p.status === 'ordered' ? 'blue' : p.status === 'draft' ? 'gray' : 'red'}>{p.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function CashierHome({ storeId }: { storeId: string }) {
  const shift = useOpenShift(storeId);
  if (shift.isLoading) return <Skeleton className="h-24 w-full" />;
  return shift.data ? <Alert tone="success">Your shift is open. <Link to="/pos" className="font-semibold underline">Go to the POS</Link> to start selling.</Alert> : <Alert tone="info">You have no open shift. <Link to="/shifts" className="font-semibold underline">Open a shift</Link> before selling.</Alert>;
}

function StockHome({ storeId }: { storeId: string }) {
  const days = useExpiryDays(storeId).data ?? 30;
  const q = useQuery({ queryKey: ['inventory', 'alerts', storeId], queryFn: async () => { const { data, error } = await supabase.from('inventory_overview').select('name, available, min_stock, next_expiry').eq('supermarket_id', storeId).eq('is_active', true); if (error) throw error; return data as Array<{ name: string; available: number; min_stock: number; next_expiry: string | null }>; } });
  const warnBy = addDaysISO(todayISO(), days);
  const low = (q.data ?? []).filter((p) => Number(p.available) <= Number(p.min_stock)); const exp = (q.data ?? []).filter((p) => p.next_expiry && p.next_expiry <= warnBy);
  return <div className="grid gap-4 sm:grid-cols-2"><Stat label="Products low or out of stock" value={String(low.length)} loading={q.isLoading} /><Stat label={`Products expiring within ${days} days`} value={String(exp.length)} loading={q.isLoading} />
    <p className="text-sm sm:col-span-2"><Link className="font-medium text-brand-600" to="/receiving">Receive stock</Link> · <Link className="font-medium text-brand-600" to="/inventory">View inventory</Link></p></div>;
}

export function DashboardPage() {
  const { isSuperAdmin, isSupportView, activeStore, activeRole, profile } = useAuth();
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hello, {profile?.full_name.split(' ')[0] || 'there'}</h1>
        <p className="mt-1 text-sm text-ink-500">
          {isSupportView && activeStore
            ? `Support view: ${activeStore.supermarket.name}`
            : isSuperAdmin
              ? 'Platform overview'
              : activeStore
                ? activeStore.supermarket.name
                : 'No supermarket'}
        </p>
      </div>

      {/* Store admin banner for pending and active access grants */}
      {!isSuperAdmin && activeRole === 'admin' && activeStore && (
        <StoreAccessBanner storeId={activeStore.supermarket_id} />
      )}

      {isSuperAdmin && !isSupportView ? (
        <PlatformDashboard />
      ) : !activeStore ? (
        <Alert tone="info">Your account is not assigned to a supermarket yet. Ask your administrator to add you.</Alert>
      ) : activeRole === 'admin' ? (
        <AdminDashboard storeId={activeStore.supermarket_id} />
      ) : activeRole === 'cashier' ? (
        <CashierHome storeId={activeStore.supermarket_id} />
      ) : (
        <StockHome storeId={activeStore.supermarket_id} />
      )}
    </div>
  );
}
