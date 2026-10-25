import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { Alert, Card, Skeleton } from '@/components/ui';
import { Badge, ErrorState } from '@/components/kit';
import { addDaysISO, formatDateTime, formatMoney, formatQty, METHOD_LABEL, todayISO } from '@/lib/format';
import { usePeriods, useProfit } from '@/features/reports/ReportsPage';
import { usePlatform } from '@/features/reports/PlatformReportsPage';
import { useExpiryDays } from '@/features/inventory/InventoryPage';
import { useOpenShift } from '@/features/shifts/useShift';
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
  const days = useExpiryDays(storeId).data ?? 30;
  const stock = useQuery({ queryKey: ['inventory', 'alerts', storeId], queryFn: async () => { const { data, error } = await supabase.from('inventory_overview').select('name, available, min_stock, next_expiry').eq('supermarket_id', storeId).eq('is_active', true); if (error) throw error; return data as Array<{ name: string; available: number; min_stock: number; next_expiry: string | null }>; } });
  const recent = useQuery({ queryKey: ['sales', 'recent', storeId], queryFn: async () => { const { data, error } = await supabase.from('sales').select('id, receipt_number, total, currency, created_at, status, cashier:profiles(full_name)').eq('supermarket_id', storeId).order('created_at', { ascending: false }).limit(6); if (error) throw error; return data as unknown as Array<{ id: string; receipt_number: string; total: number; currency: Currency; created_at: string; status: string; cashier: { full_name: string } | null }>; } });
  const purchases = useQuery({ queryKey: ['purchase-orders', 'recent', storeId], queryFn: async () => { const { data, error } = await supabase.from('purchase_orders').select('id, reference, status, created_at, supplier:suppliers(name)').eq('supermarket_id', storeId).order('created_at', { ascending: false }).limit(5); if (error) throw error; return data as unknown as Array<{ id: string; reference: string | null; status: string; created_at: string; supplier: { name: string } | null }>; } });
  const pay = useQuery({ queryKey: ['report', 'pay-today', storeId, today], queryFn: async () => rpc<Array<{ label: string; currency: Currency; quantity: number; amount: number }>>('report_sales_breakdown', { p_store: storeId, p_from: today, p_to: today, p_dim: 'payment_method' }) });
  const cashiers = useQuery({ queryKey: ['report', 'cashier-today', storeId, today], queryFn: async () => rpc<Array<{ label: string; currency: Currency; quantity: number; amount: number }>>('report_sales_breakdown', { p_store: storeId, p_from: today, p_to: today, p_dim: 'cashier' }) });
  const todayRows = (trend.data ?? []).filter((p) => p.period === today);
  const count = todayRows.reduce((s, p) => s + Number(p.sales_count), 0);
  const warnBy = addDaysISO(today, days);
  const low = (stock.data ?? []).filter((p) => Number(p.available) <= Number(p.min_stock));
  const expiring = (stock.data ?? []).filter((p) => p.next_expiry && p.next_expiry <= warnBy);
  const trendData = Array.from({ length: 14 }, (_, i) => { const d = addDaysISO(today, -13 + i); return { date: d.slice(5), USD: Number((trend.data ?? []).find((p) => p.period === d && p.currency === 'USD')?.net_sales ?? 0) }; });
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CURS.map((c) => <Stat key={c} label={`Today's net sales (${c})`} value={formatMoney(todayRows.find((p) => p.currency === c)?.net_sales ?? 0, c)} loading={trend.isLoading} />)}
        <Stat label="Completed transactions today" value={String(count)} loading={trend.isLoading} />
        <Stat label="Estimated operating result today" value={formatMoney(profit.data?.find((p) => p.currency === 'USD')?.operating_result ?? 0, 'USD')} hint={`and ${formatMoney(profit.data?.find((p) => p.currency === 'SOS')?.operating_result ?? 0, 'SOS')}. Estimate: FIFO gross profit minus recorded expenses.`} loading={profit.isLoading} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><h2 className="mb-3 font-semibold">Net sales, last 14 days (USD)</h2>{trend.isLoading ? <Skeleton className="h-48 w-full" /> : <div className="h-48"><ResponsiveContainer><BarChart data={trendData}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" fontSize={11} /><YAxis fontSize={11} width={50} /><Tooltip formatter={(v) => formatMoney(Number(v), 'USD')} /><Bar dataKey="USD" fill="#2563eb" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>}</Card>
        <Card><h2 className="mb-3 font-semibold">Alerts</h2>
          <div className="space-y-3 text-sm"><div><div className="mb-1 flex items-center gap-2 font-medium">Low stock <Badge tone={low.length ? 'amber' : 'green'}>{low.length}</Badge></div>{low.slice(0, 5).map((p) => <div key={p.name} className="flex justify-between text-ink-700"><span>{p.name}</span><span>{formatQty(p.available)} left</span></div>)}</div>
            <div><div className="mb-1 flex items-center gap-2 font-medium">Expiring within {days} days <Badge tone={expiring.length ? 'amber' : 'green'}>{expiring.length}</Badge></div>{expiring.slice(0, 5).map((p) => <div key={p.name} className="flex justify-between text-ink-700"><span>{p.name}</span><span>{p.next_expiry}</span></div>)}</div>
            <Link to="/inventory" className="font-medium text-brand-600">Open inventory</Link></div></Card>
        <Card><h2 className="mb-3 font-semibold">Payments today</h2>{(pay.data ?? []).length === 0 ? <p className="text-sm text-ink-500">No payments yet today.</p> : <ul className="space-y-1 text-sm">{pay.data!.map((p, i) => <li key={i} className="flex justify-between"><span>{METHOD_LABEL[p.label] ?? p.label} ({p.currency})</span><span className="font-medium">{formatMoney(p.amount, p.currency)}</span></li>)}</ul>}</Card>
        <Card><h2 className="mb-3 font-semibold">Cashier performance today</h2>{(cashiers.data ?? []).length === 0 ? <p className="text-sm text-ink-500">No sales yet today.</p> : <ul className="space-y-1 text-sm">{cashiers.data!.map((p, i) => <li key={i} className="flex justify-between"><span>{p.label} <span className="text-ink-500">({Number(p.quantity)} sales)</span></span><span className="font-medium">{formatMoney(p.amount, p.currency)}</span></li>)}</ul>}</Card>
        <Card><h2 className="mb-3 font-semibold">Recent sales</h2>{recent.isLoading ? <Skeleton className="h-24 w-full" /> : (recent.data ?? []).length === 0 ? <p className="text-sm text-ink-500">No sales yet.</p> : <ul className="space-y-1.5 text-sm">{recent.data!.map((s) => <li key={s.id} className="flex justify-between"><span><span className="font-mono text-xs">{s.receipt_number}</span> <span className="text-ink-500">{formatDateTime(s.created_at)}</span></span><span className="font-medium">{formatMoney(s.total, s.currency)}</span></li>)}</ul>}</Card>
        <Card><h2 className="mb-3 font-semibold">Recent purchases</h2>{(purchases.data ?? []).length === 0 ? <p className="text-sm text-ink-500">No purchase orders yet.</p> : <ul className="space-y-1.5 text-sm">{purchases.data!.map((p) => <li key={p.id} className="flex justify-between"><span>{p.supplier?.name} <span className="text-ink-500">{p.reference ?? ''}</span></span><Badge>{p.status.replace('_', ' ')}</Badge></li>)}</ul>}</Card>
      </div>
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
  const { isSuperAdmin, activeStore, activeRole, profile } = useAuth();
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div><h1 className="text-2xl font-semibold tracking-tight">Hello, {profile?.full_name.split(' ')[0] || 'there'}</h1>
        <p className="mt-1 text-sm text-ink-500">{isSuperAdmin ? 'Platform overview' : activeStore ? activeStore.supermarket.name : 'No supermarket'}</p></div>
      {isSuperAdmin ? <PlatformDashboard /> : !activeStore ? <Alert tone="info">Your account is not assigned to a supermarket yet. Ask your administrator to add you.</Alert>
        : activeRole === 'admin' ? <AdminDashboard storeId={activeStore.supermarket_id} /> : activeRole === 'cashier' ? <CashierHome storeId={activeStore.supermarket_id} /> : <StockHome storeId={activeStore.supermarket_id} />}
    </div>
  );
}
