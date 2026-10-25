import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useAction } from '@/hooks/useAction';
import { useStoreId } from '@/hooks/useStore';
import { useAuth } from '@/features/auth/AuthProvider';
import { Alert, Button, Card, Field, Skeleton } from '@/components/ui';
import { Badge, EmptyState, ErrorState, Modal, PageHeader, Pagination, SelectField, Table, TableSkeleton, Td, Th } from '@/components/kit';
import { formatDateTime, formatMoney, METHOD_LABEL } from '@/lib/format';
import type { Currency } from '@/types/database';
import { useOpenShift, type Shift } from './useShift';

interface Summary {
  shift: Shift; sales_count: number; expected_usd: number; expected_sos: number;
  sales_by_currency: Array<{ currency: Currency; count: number; total: number }>;
  payments_by_method: Array<{ method: string; currency: Currency; amount: number }>;
}
const PAGE = 15;

export function useShiftSummary(shiftId: string | undefined) {
  return useQuery({ queryKey: ['shift-summary', shiftId], enabled: !!shiftId, queryFn: () => rpc<Summary>('get_shift_summary', { p_shift: shiftId }) });
}

export function SummaryCard({ s }: { s: Summary }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card><p className="text-sm text-ink-500">Sales in this shift</p><p className="mt-1 text-3xl font-semibold">{s.sales_count}</p>
        <ul className="mt-2 space-y-0.5 text-sm">{s.sales_by_currency.map((c) => <li key={c.currency}>{formatMoney(c.total, c.currency)} <span className="text-ink-500">({c.count} sales)</span></li>)}</ul></Card>
      <Card><p className="text-sm text-ink-500">Expected cash in the drawer</p>
        <p className="mt-1 text-xl font-semibold">{formatMoney(s.expected_usd, 'USD')} <span className="text-ink-300">+</span> {formatMoney(s.expected_sos, 'SOS')}</p>
        <p className="mt-1 text-xs text-ink-500">Opening cash + cash sales + cash in - cash out - cash refunds. Mobile money is not included.</p></Card>
      <Card className="sm:col-span-2"><p className="mb-2 text-sm text-ink-500">Payments by method</p>
        {s.payments_by_method.length === 0 ? <p className="text-sm text-ink-500">No payments yet.</p> : <ul className="grid gap-1 text-sm sm:grid-cols-2">{s.payments_by_method.map((p, i) => <li key={i} className="flex justify-between"><span>{METHOD_LABEL[p.method]} ({p.currency})</span><span className="font-medium">{formatMoney(p.amount, p.currency)}</span></li>)}</ul>}</Card>
    </div>
  );
}

export function ShiftsPage() {
  const storeId = useStoreId();
  const { activeRole, profile } = useAuth();
  const isCashier = activeRole === 'cashier';
  const open = useOpenShift(storeId);
  const summary = useShiftSummary(open.data?.id);
  const [opening, setOpening] = useState({ usd: '0', sos: '0' });
  const [movement, setMovement] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closedSummary, setClosedSummary] = useState<Summary | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const openShift = useAction(() => rpc('open_shift', { p_store: storeId, p_opening_usd: Number(opening.usd || 0), p_opening_sos: Number(opening.sos || 0) }), { invalidate: ['open-shift', 'shifts'], success: 'Shift opened' });
  const history = useQuery({ queryKey: ['shifts', storeId, page, isCashier], queryFn: async () => {
    let q = supabase.from('cashier_shifts').select('id, status, opened_at, closed_at, difference_usd, difference_sos, cashier:profiles(full_name)', { count: 'exact' }).eq('supermarket_id', storeId).eq('status', 'closed').order('opened_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (isCashier) q = q.eq('cashier_id', profile!.id);
    const { data, error, count } = await q; if (error) throw error;
    return { rows: data as unknown as Array<{ id: string; opened_at: string; closed_at: string; difference_usd: number; difference_sos: number; cashier: { full_name: string } | null }>, total: count ?? 0 }; } });
  const bad = (v: string) => v !== '' && !(Number(v) >= 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Cashier shifts" subtitle={isCashier ? 'Open a shift before selling and close it when you count your cash.' : 'Closed shifts and cash differences.'} />
      {isCashier && (open.isLoading ? <Skeleton className="h-40 w-full" /> : open.isError ? <ErrorState onRetry={() => void open.refetch()} /> : !open.data ? (
        <Card className="max-w-md space-y-4">
          <h2 className="font-semibold">Open a shift</h2>
          <p className="text-sm text-ink-500">Count the cash in your drawer and enter it for each currency.</p>
          <Field label="Opening cash (USD)" type="number" min={0} step="0.01" value={opening.usd} onChange={(e) => setOpening({ ...opening, usd: e.target.value })} error={bad(opening.usd) ? 'Cannot be negative' : undefined} />
          <Field label="Opening cash (SOS)" type="number" min={0} step="1" value={opening.sos} onChange={(e) => setOpening({ ...opening, sos: e.target.value })} error={bad(opening.sos) ? 'Cannot be negative' : undefined} />
          <Button disabled={bad(opening.usd) || bad(opening.sos)} loading={openShift.isPending} onClick={() => openShift.mutate(undefined)}>Open shift</Button>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><Badge tone="green">Shift open</Badge> <span className="ml-2 text-sm text-ink-500">since {formatDateTime(open.data.opened_at)}</span></div>
            <div className="flex gap-2"><Link to="/pos" className="inline-flex h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">Go to POS</Link>
              <Button variant="secondary" onClick={() => setMovement(true)}>Cash in / out</Button><Button variant="secondary" onClick={() => setClosing(true)}>Close shift</Button></div>
          </div>
          {summary.isLoading ? <Skeleton className="h-40 w-full" /> : summary.data && <SummaryCard s={summary.data} />}
        </>
      ))}
      {closedSummary && <Alert tone="success">Shift closed. Cash difference: {formatMoney(closedSummary.shift.difference_usd, 'USD')} and {formatMoney(closedSummary.shift.difference_sos, 'SOS')}. {Number(closedSummary.shift.difference_usd) !== 0 || Number(closedSummary.shift.difference_sos) !== 0 ? 'Tell your manager about the difference.' : 'Your drawer balances.'}</Alert>}
      <div>
        <h2 className="mb-2 font-semibold">Closed shifts</h2>
        {history.isLoading ? <TableSkeleton rows={3} /> : history.isError ? <ErrorState onRetry={() => void history.refetch()} /> : history.data!.rows.length === 0 ? <EmptyState title="No closed shifts yet" /> : <>
          <Table><thead><tr><Th>Cashier</Th><Th>Opened</Th><Th>Closed</Th><Th right>Difference</Th><Th right>Details</Th></tr></thead>
            <tbody>{history.data!.rows.map((r) => <tr key={r.id}><Td className="font-medium">{r.cashier?.full_name}</Td><Td>{formatDateTime(r.opened_at)}</Td><Td>{formatDateTime(r.closed_at)}</Td>
              <Td right><span className={Number(r.difference_usd) || Number(r.difference_sos) ? 'font-medium text-red-600' : ''}>{formatMoney(r.difference_usd, 'USD')} / {formatMoney(r.difference_sos, 'SOS')}</span></Td>
              <Td right><Button variant="ghost" className="h-9" onClick={() => setViewing(r.id)}>View</Button></Td></tr>)}</tbody></Table>
          <Pagination page={page} pageSize={PAGE} total={history.data!.total} onChange={setPage} /></>}
      </div>
      {movement && open.data && <Movement shiftId={open.data.id} onClose={() => setMovement(false)} />}
      {closing && open.data && summary.data && <Close shiftId={open.data.id} onClose={() => setClosing(false)} onClosed={(s) => { setClosedSummary(s); setClosing(false); }} />}
      {viewing && <ViewShift id={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function Movement({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const [kind, setKind] = useState('cash_in'); const [currency, setCurrency] = useState<Currency>('USD'); const [amount, setAmount] = useState(''); const [reason, setReason] = useState('');
  const save = useAction(() => rpc('record_cash_movement', { p_shift: shiftId, p_kind: kind, p_currency: currency, p_amount: Number(amount), p_reason: reason }), { invalidate: ['shift-summary'], success: 'Recorded', onDone: onClose });
  return (
    <Modal title="Cash in / cash out" onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3"><SelectField label="Type" value={kind} onChange={(e) => setKind(e.target.value)}><option value="cash_in">Cash in (added to drawer)</option><option value="cash_out">Cash out (taken from drawer)</option></SelectField>
          <SelectField label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}><option>USD</option><option>SOS</option></SelectField></div>
        <Field label="Amount" type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Field label="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!(Number(amount) > 0) || reason.trim().length < 3} loading={save.isPending} onClick={() => save.mutate(undefined)}>Record</Button></div>
      </div>
    </Modal>
  );
}

function Close({ shiftId, onClose, onClosed }: { shiftId: string; onClose: () => void; onClosed: (s: Summary) => void }) {
  const [usd, setUsd] = useState(''); const [sos, setSos] = useState(''); const [notes, setNotes] = useState('');
  const close = useAction(() => rpc<Summary>('close_shift', { p_shift: shiftId, p_closing_usd: Number(usd), p_closing_sos: Number(sos), p_notes: notes }), { invalidate: ['open-shift', 'shifts', 'shift-summary'], onDone: onClosed });
  const ok = usd !== '' && sos !== '' && Number(usd) >= 0 && Number(sos) >= 0;
  return (
    <Modal title="Close shift" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-ink-500">Count the cash in your drawer. The system compares it with what it expects and records any difference. You will not be able to sell on this shift afterwards.</p>
        <Field label="Counted cash (USD)" type="number" min={0} step="0.01" value={usd} onChange={(e) => setUsd(e.target.value)} />
        <Field label="Counted cash (SOS)" type="number" min={0} step="1" value={sos} onChange={(e) => setSos(e.target.value)} />
        <Field label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!ok} loading={close.isPending} onClick={() => close.mutate(undefined)}>Close shift</Button></div>
      </div>
    </Modal>
  );
}

function ViewShift({ id, onClose }: { id: string; onClose: () => void }) {
  const s = useShiftSummary(id);
  return (
    <Modal title="Shift summary" onClose={onClose} wide>
      {s.isLoading ? <Skeleton className="h-40 w-full" /> : s.isError ? <ErrorState /> : (
        <div className="space-y-4"><SummaryCard s={s.data!} />
          <Card><div className="grid gap-1 text-sm sm:grid-cols-2">
            <div>Closing cash: <b>{formatMoney(s.data!.shift.closing_usd, 'USD')} / {formatMoney(s.data!.shift.closing_sos, 'SOS')}</b></div>
            <div>Difference: <b>{formatMoney(s.data!.shift.difference_usd, 'USD')} / {formatMoney(s.data!.shift.difference_sos, 'SOS')}</b></div></div>
            {s.data!.shift.notes && <p className="mt-2 text-sm text-ink-500">Notes: {s.data!.shift.notes}</p>}</Card></div>)}
    </Modal>
  );
}
