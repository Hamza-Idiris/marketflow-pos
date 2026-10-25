import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useStoreId } from '@/hooks/useStore';
import { Button, Card, Field } from '@/components/ui';
import { EmptyState, ErrorState, PageHeader, SelectField, Table, TableSkeleton, Td, Th } from '@/components/kit';
import { downloadCsv } from '@/lib/csv';
import { addDaysISO, formatDate, formatMoney, formatQty, todayISO } from '@/lib/format';
import type { Currency } from '@/types/database';

interface Period { period: string; currency: Currency; sales_count: number; subtotal: number; discounts: number; net_sales: number; refunds: number }
interface Profit { currency: Currency; net_sales: number; discounts: number; refunds: number; cogs: number; gross_profit: number; expenses: number; operating_result: number }
interface Break { label: string; currency: Currency; quantity: number; amount: number }
type Dim = 'product' | 'category' | 'cashier' | 'payment_method';
const DIMS: Array<[Dim, string]> = [['product', 'By product'], ['category', 'By category'], ['cashier', 'By cashier'], ['payment_method', 'By payment method']];
const num = <T extends object>(r: T) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && v !== '' && !isNaN(Number(v)) && k !== 'period' && k !== 'label' ? Number(v) : v])) as T;

export function useProfit(storeId: string, from: string, to: string) {
  return useQuery({ queryKey: ['report', 'profit', storeId, from, to], queryFn: async () => (await rpc<Profit[]>('report_profit', { p_store: storeId, p_from: from, p_to: to })).map(num) });
}
export function usePeriods(storeId: string, from: string, to: string, grain: string) {
  return useQuery({ queryKey: ['report', 'periods', storeId, from, to, grain], queryFn: async () => (await rpc<Period[]>('report_sales_by_period', { p_store: storeId, p_from: from, p_to: to, p_grain: grain })).map(num) });
}

export function ReportsPage() {
  const storeId = useStoreId();
  const [from, setFrom] = useState(addDaysISO(todayISO(), -29));
  const [to, setTo] = useState(todayISO());
  const [grain, setGrain] = useState<'day' | 'week' | 'month'>('day');
  const [dim, setDim] = useState<Dim>('product');
  const [chartCur, setChartCur] = useState<Currency>('USD');
  const profit = useProfit(storeId, from, to);
  const periods = usePeriods(storeId, from, to, grain);
  const brk = useQuery({ queryKey: ['report', 'break', storeId, from, to, dim], queryFn: async () => (await rpc<Break[]>('report_sales_breakdown', { p_store: storeId, p_from: from, p_to: to, p_dim: dim })).map(num) });
  const stock = useQuery({ queryKey: ['report', 'stock', storeId], queryFn: async () => {
    const { data, error } = await supabase.from('inventory_overview').select('name, available, min_stock, expired_quantity, next_expiry, value_usd, value_sos').eq('supermarket_id', storeId).eq('is_active', true).order('name'); if (error) throw error;
    return (data as Array<Record<string, string | number | null>>).map((r) => ({ Product: r.name, Available: Number(r.available), Minimum: Number(r.min_stock), 'Expired quantity': Number(r.expired_quantity), 'Next expiry': r.next_expiry ?? '', 'Value USD cost': Number(r.value_usd), 'Value SOS cost': Number(r.value_sos) })); } });
  const range = from <= to;
  const chart = (periods.data ?? []).filter((p) => p.currency === chartCur).map((p) => ({ date: formatDate(p.period), Sales: p.net_sales }));
  const exp = (name: string, rows: unknown[] | undefined) => rows && rows.length ? downloadCsv(`${name}-${from}-to-${to}.csv`, rows as Array<Record<string, unknown>>) : undefined;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Reports" subtitle="All figures come straight from your sales, stock lots and expenses. Currencies are never mixed." />
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="From" type="date" max={to} value={from} onChange={(e) => setFrom(e.target.value)} />
        <Field label="To" type="date" min={from} max={todayISO()} value={to} onChange={(e) => setTo(e.target.value)} />
        <SelectField label="Group sales by" value={grain} onChange={(e) => setGrain(e.target.value as typeof grain)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></SelectField>
        <SelectField label="Chart currency" value={chartCur} onChange={(e) => setChartCur(e.target.value as Currency)}><option>USD</option><option>SOS</option></SelectField>
      </div>
      {!range && <ErrorState message="The start date must be before the end date." />}

      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Profit estimate</h2><Button variant="secondary" className="h-9" onClick={() => exp('profit', profit.data?.map((p) => ({ Currency: p.currency, 'Net sales': p.net_sales, Discounts: p.discounts, Refunds: p.refunds, 'Cost of goods sold (FIFO)': p.cogs, 'Gross profit': p.gross_profit, 'Recorded expenses': p.expenses, 'Estimated operating result': p.operating_result })))}><Download className="h-4 w-4" />CSV</Button></div>
        {profit.isLoading ? <TableSkeleton rows={2} /> : profit.isError ? <ErrorState onRetry={() => void profit.refetch()} /> : (
          <Table><thead><tr><Th>Currency</Th><Th right>Net sales</Th><Th right>Discounts given</Th><Th right>Refunds</Th><Th right>Cost of goods (FIFO)</Th><Th right>Gross profit</Th><Th right>Expenses</Th><Th right>Estimated result</Th></tr></thead>
            <tbody>{profit.data!.map((p) => <tr key={p.currency}><Td className="font-medium">{p.currency}</Td><Td right>{formatMoney(p.net_sales, p.currency)}</Td><Td right>{formatMoney(p.discounts, p.currency)}</Td><Td right>{formatMoney(p.refunds, p.currency)}</Td><Td right>{formatMoney(p.cogs, p.currency)}</Td><Td right className="font-semibold">{formatMoney(p.gross_profit, p.currency)}</Td><Td right>{formatMoney(p.expenses, p.currency)}</Td><Td right className="font-semibold">{formatMoney(p.operating_result, p.currency)}</Td></tr>)}</tbody></Table>)}
        <p className="text-xs text-ink-500">Net sales = sales after discounts minus refunds. Gross profit = net sales minus the FIFO cost of the exact stock lots sold (cost of restocked returns is credited back). Estimated result = gross profit minus recorded, non-cancelled expenses. It excludes taxes, supplier debts and other accounting adjustments, so it is not a formal net profit. Stock bought in another currency is costed at the exchange rate in force when it was sold.</p>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Sales over time</h2><Button variant="secondary" className="h-9" onClick={() => exp('sales-by-period', periods.data?.map((p) => ({ Period: p.period, Currency: p.currency, Sales: p.sales_count, Subtotal: p.subtotal, Discounts: p.discounts, 'Net sales': p.net_sales, Refunds: p.refunds })))}><Download className="h-4 w-4" />CSV</Button></div>
        {periods.isLoading ? <TableSkeleton rows={3} /> : periods.isError ? <ErrorState onRetry={() => void periods.refetch()} /> : chart.length === 0 ? <EmptyState title="No sales in this period" /> : (
          <Card><div className="h-64 w-full"><ResponsiveContainer><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" fontSize={12} /><YAxis fontSize={12} width={60} /><Tooltip formatter={(v) => formatMoney(Number(v), chartCur)} /><Legend /><Bar dataKey="Sales" fill="#2563eb" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>)}
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3"><div className="w-56"><SelectField label="Breakdown" value={dim} onChange={(e) => setDim(e.target.value as Dim)}>{DIMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectField></div>
          <Button variant="secondary" className="h-9" onClick={() => exp(`sales-${dim}`, brk.data?.map((b) => ({ Name: b.label, Currency: b.currency, [dim === 'cashier' || dim === 'payment_method' ? 'Count' : 'Quantity']: b.quantity, Amount: b.amount })))}><Download className="h-4 w-4" />CSV</Button></div>
        {brk.isLoading ? <TableSkeleton rows={4} /> : brk.isError ? <ErrorState onRetry={() => void brk.refetch()} /> : brk.data!.length === 0 ? <EmptyState title="Nothing to show" /> : (
          <Table><thead><tr><Th>{dim === 'payment_method' ? 'Method' : dim === 'cashier' ? 'Cashier' : dim === 'category' ? 'Category' : 'Product'}</Th><Th>Currency</Th><Th right>{dim === 'cashier' || dim === 'payment_method' ? 'Count' : 'Quantity'}</Th><Th right>Amount</Th></tr></thead>
            <tbody>{brk.data!.slice(0, 100).map((b, i) => <tr key={i}><Td className="font-medium">{dim === 'payment_method' ? b.label.replace('_', ' ') : b.label}</Td><Td>{b.currency}</Td><Td right>{formatQty(b.quantity)}</Td><Td right>{formatMoney(b.amount, b.currency)}</Td></tr>)}</tbody></Table>)}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Stock valuation, low stock and expiry</h2><Button variant="secondary" className="h-9" onClick={() => exp('stock', stock.data)}><Download className="h-4 w-4" />CSV</Button></div>
        <p className="text-sm text-ink-500">Current stock at purchase cost (USD-cost and SOS-cost lots shown separately). The CSV lists every product with quantity, minimum, expired quantity and next expiry date.</p>
        {stock.isError && <ErrorState onRetry={() => void stock.refetch()} />}
        {stock.data && <Card><div className="grid gap-2 text-sm sm:grid-cols-4">
          <div><div className="text-ink-500">Inventory value (USD cost)</div><div className="text-lg font-semibold">{formatMoney(stock.data.reduce((s, r) => s + r['Value USD cost'], 0), 'USD')}</div></div>
          <div><div className="text-ink-500">Inventory value (SOS cost)</div><div className="text-lg font-semibold">{formatMoney(stock.data.reduce((s, r) => s + r['Value SOS cost'], 0), 'SOS')}</div></div>
          <div><div className="text-ink-500">Low or out of stock</div><div className="text-lg font-semibold">{stock.data.filter((r) => r.Available <= r.Minimum).length}</div></div>
          <div><div className="text-ink-500">Products with expired units</div><div className="text-lg font-semibold">{stock.data.filter((r) => r['Expired quantity'] > 0).length}</div></div></div></Card>}
      </section>
    </div>
  );
}
