import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, RotateCcw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useAction } from '@/hooks/useAction';
import { useStoreId } from '@/hooks/useStore';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button, Field, Skeleton } from '@/components/ui';
import { Badge, EmptyState, ErrorState, Modal, PageHeader, Pagination, SelectField, Table, TableSkeleton, Td, Th } from '@/components/kit';
import { addDaysISO, formatDateTime, formatMoney, formatQty, METHOD_LABEL, todayISO } from '@/lib/format';
import { Receipt } from './Receipt';
import type { Currency, PaymentMethod, ReceiptData } from '@/types/database';

const PAGE = 20;
interface Row { id: string; receipt_number: string; currency: Currency; total: number; status: string; created_at: string; cashier: { full_name: string } | null }
const TONE: Record<string, 'green' | 'amber' | 'red' | 'gray'> = { completed: 'green', partially_refunded: 'amber', refunded: 'red', voided: 'gray' };

export function SalesHistoryPage() {
  const storeId = useStoreId();
  const { activeRole } = useAuth();
  const isAdmin = activeRole === 'admin';
  const [page, setPage] = useState(0);
  const [from, setFrom] = useState(addDaysISO(todayISO(), -7));
  const [to, setTo] = useState(todayISO());
  const [status, setStatus] = useState('');
  const [term, setTerm] = useState('');
  const [view, setView] = useState<string | null>(null);
  const [refund, setRefund] = useState<{ id: string; mode: 'refund' | 'void' } | null>(null);

  const q = useQuery({ queryKey: ['sales', storeId, page, from, to, status, term], queryFn: async () => {
    // Day boundaries are Mogadishu local time (UTC+3, no daylight saving).
    let query = supabase.from('sales').select('id, receipt_number, currency, total, status, created_at, cashier:profiles(full_name)', { count: 'exact' }).eq('supermarket_id', storeId)
      .gte('created_at', `${from}T00:00:00+03:00`).lt('created_at', `${addDaysISO(to, 1)}T00:00:00+03:00`).order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (status) query = query.eq('status', status);
    if (term.trim()) query = query.ilike('receipt_number', `%${term.trim().replace(/[%,]/g, '')}%`);
    const { data, error, count } = await query; if (error) throw error;
    return { rows: data as unknown as Row[], total: count ?? 0 }; } });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Sales history" subtitle={isAdmin ? 'Every sale in this supermarket.' : 'Your own sales.'} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="From" type="date" max={to} value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
        <Field label="To" type="date" min={from} max={todayISO()} value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
        <SelectField label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}><option value="">All</option><option value="completed">Completed</option><option value="partially_refunded">Partly refunded</option><option value="refunded">Refunded</option><option value="voided">Voided</option></SelectField>
        <Field label="Receipt number" placeholder="R-..." value={term} onChange={(e) => { setTerm(e.target.value); setPage(0); }} />
      </div>
      {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : q.data!.rows.length === 0 ? <EmptyState title="No sales found" hint="Try a wider date range." /> : <>
        <Table><thead><tr><Th>Receipt</Th><Th>Time</Th><Th>Cashier</Th><Th right>Total</Th><Th>Status</Th><Th right>Actions</Th></tr></thead>
          <tbody>{q.data!.rows.map((r) => <tr key={r.id}><Td className="font-mono text-xs">{r.receipt_number}</Td><Td>{formatDateTime(r.created_at)}</Td><Td>{r.cashier?.full_name}</Td><Td right>{formatMoney(r.total, r.currency)}</Td>
            <Td><Badge tone={TONE[r.status] ?? 'gray'}>{r.status.replace('_', ' ')}</Badge></Td>
            <Td right><div className="flex justify-end gap-1"><Button variant="ghost" className="h-9" onClick={() => setView(r.id)}><Eye className="h-4 w-4" />View</Button>
              {isAdmin && (r.status === 'completed' || r.status === 'partially_refunded') && <Button variant="ghost" className="h-9" onClick={() => setRefund({ id: r.id, mode: 'refund' })}><RotateCcw className="h-4 w-4" />Refund</Button>}
              {isAdmin && r.status === 'completed' && <Button variant="ghost" className="h-9 text-red-600" onClick={() => setRefund({ id: r.id, mode: 'void' })}>Void</Button>}</div></Td></tr>)}</tbody></Table>
        <Pagination page={page} pageSize={PAGE} total={q.data!.total} onChange={setPage} /></>}
      {view && <ViewReceipt id={view} onClose={() => setView(null)} />}
      {refund && <RefundModal saleId={refund.id} mode={refund.mode} onClose={() => setRefund(null)} />}
    </div>
  );
}

function ViewReceipt({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['receipt', id], queryFn: () => rpc<ReceiptData>('get_receipt', { p_sale: id }) });
  return <Modal title="Receipt" onClose={onClose}>{q.isLoading ? <Skeleton className="h-64 w-full" /> : q.isError ? <ErrorState /> : <Receipt data={q.data!} reprint onPrintRequested={() => void q.refetch()} />}</Modal>;
}

interface Item { id: string; product_name: string; quantity: number; line_total: number }
function RefundModal({ saleId, mode, onClose }: { saleId: string; mode: 'refund' | 'void'; onClose: () => void }) {
  const q = useQuery({ queryKey: ['refund-data', saleId], queryFn: async () => {
    const [items, done, sale] = await Promise.all([
      supabase.from('sale_items_public').select('id, product_name, quantity, line_total').eq('sale_id', saleId),
      supabase.from('refund_items').select('sale_item_id, quantity, refund:refunds!inner(sale_id)').eq('refund.sale_id', saleId),
      supabase.from('sales').select('currency, total').eq('id', saleId).single()]);
    if (items.error) throw items.error; if (done.error) throw done.error; if (sale.error) throw sale.error;
    const refunded = new Map<string, number>(); (done.data as unknown as Array<{ sale_item_id: string; quantity: number }>).forEach((d) => refunded.set(d.sale_item_id, (refunded.get(d.sale_item_id) ?? 0) + Number(d.quantity)));
    return { items: (items.data as Item[]).map((i) => ({ ...i, quantity: Number(i.quantity), remaining: Number(i.quantity) - (refunded.get(i.id) ?? 0) })), currency: sale.data.currency as Currency }; } });
  const [qty, setQty] = useState<Record<string, string>>({});
  const [disp, setDisp] = useState<Record<string, 'restock' | 'write_off'>>({});
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const picked = (q.data?.items ?? []).filter((i) => Number(qty[i.id]) > 0);
  const over = picked.some((i) => Number(qty[i.id]) > i.remaining);
  const save = useAction(() => mode === 'void'
    ? rpc('void_sale', { p_sale: saleId, p_reason: reason, p_method: method })
    : rpc('refund_sale', { p_sale: saleId, p_reason: reason, p_method: method, p_items: picked.map((i) => ({ sale_item_id: i.id, quantity: Number(qty[i.id]), disposition: disp[i.id] ?? 'restock' })) }),
    { invalidate: ['sales', 'pos-catalog', 'inventory', 'shift-summary', 'receipt'], success: mode === 'void' ? 'Sale voided' : 'Refund recorded', onDone: onClose });
  const ok = reason.trim().length >= 3 && (mode === 'void' || (picked.length > 0 && !over));
  return (
    <Modal title={mode === 'void' ? 'Void sale' : 'Refund items'} onClose={onClose} wide>
      {q.isLoading ? <Skeleton className="h-40 w-full" /> : q.isError ? <ErrorState /> : (
        <div className="space-y-4">
          <p className="text-sm text-ink-500">{mode === 'void' ? 'The whole sale is reversed and every item is returned to stock. The original sale stays in the records.' : 'Choose what the customer returns. Goods are only put back on the shelf if you mark them resaleable; expired or damaged goods are written off.'}</p>
          {mode === 'refund' && <div className="space-y-2">{q.data!.items.map((i) => (
            <div key={i.id} className="grid grid-cols-[1fr_5rem_9rem] items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm">
              <div><div className="font-medium">{i.product_name}</div><div className="text-xs text-ink-500">Sold {formatQty(i.quantity)}, refundable {formatQty(i.remaining)}</div></div>
              <input aria-label={`Quantity to refund for ${i.product_name}`} disabled={i.remaining <= 0} inputMode="decimal" placeholder="0" value={qty[i.id] ?? ''} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} className={`h-10 rounded-lg border px-2 text-right ${Number(qty[i.id]) > i.remaining ? 'border-red-500' : 'border-ink-300'}`} />
              <select aria-label="Condition" value={disp[i.id] ?? 'restock'} onChange={(e) => setDisp({ ...disp, [i.id]: e.target.value as 'restock' | 'write_off' })} className="h-10 rounded-lg border border-ink-300 bg-white px-2"><option value="restock">Resaleable (restock)</option><option value="write_off">Damaged/expired (write off)</option></select>
            </div>))}{over && <p className="text-sm text-red-600">One quantity is more than what can still be refunded.</p>}</div>}
          <div className="grid gap-3 sm:grid-cols-2"><SelectField label="Refund paid back by" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>{(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</SelectField>
            <Field label="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <p className="text-xs text-ink-500">Cash refunds are deducted from the expected cash of the sale's shift if that shift is still open.</p>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!ok} loading={save.isPending} className={mode === 'void' ? 'bg-red-600 hover:bg-red-700' : ''} onClick={() => save.mutate(undefined)}>{mode === 'void' ? 'Void sale' : 'Record refund'}</Button></div>
        </div>)}
    </Modal>
  );
}
