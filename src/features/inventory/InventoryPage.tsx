import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PackagePlus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useAction } from '@/hooks/useAction';
import { useStoreId } from '@/hooks/useStore';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button, Field } from '@/components/ui';
import { Badge, EmptyState, ErrorState, Modal, PageHeader, Pagination, Table, TableSkeleton, Td, Th } from '@/components/kit';
import { addDaysISO, formatDate, formatDateTime, formatMoney, formatQty, todayISO } from '@/lib/format';

type Tab = 'products' | 'lots' | 'movements';
const FILTERS = ['all', 'in', 'low', 'out', 'expiring', 'expired'] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABEL: Record<Filter, string> = { all: 'All', in: 'In stock', low: 'Low stock', out: 'Out of stock', expiring: 'Expiring soon', expired: 'Expired lots' };
interface Ov { product_id: string; name: string; sku: string | null; barcode: string | null; min_stock: number; available: number; expired_quantity: number; next_expiry: string | null; value_usd: number; value_sos: number; is_active: boolean }
interface Lot { id: string; lot_number: string | null; expiry_date: string | null; quantity_received: number; quantity_remaining: number; unit_cost: number; cost_currency: 'USD' | 'SOS'; received_at: string; product: { name: string } | null }
const PAGE = 20;

export function useExpiryDays(storeId: string) {
  return useQuery({ queryKey: ['expiry-days', storeId], queryFn: async () => {
    const { data, error } = await supabase.from('store_settings').select('expiry_warning_days').eq('supermarket_id', storeId).single(); if (error) throw error; return data.expiry_warning_days as number; } });
}

export function InventoryPage() {
  const storeId = useStoreId();
  const { activeRole } = useAuth();
  const [tab, setTab] = useState<Tab>('products');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [adjust, setAdjust] = useState<Lot | null>(null);
  const days = useExpiryDays(storeId).data ?? 30;
  const warnBy = addDaysISO(todayISO(), days);

  const overview = useQuery({ queryKey: ['inventory', 'overview', storeId], enabled: tab === 'products', queryFn: async () => {
    const { data, error } = await supabase.from('inventory_overview').select('product_id, name, sku, barcode, min_stock, available, expired_quantity, next_expiry, value_usd, value_sos, is_active').eq('supermarket_id', storeId).eq('is_active', true).order('name');
    if (error) throw error; return (data as Ov[]).map((r) => ({ ...r, available: Number(r.available), min_stock: Number(r.min_stock), expired_quantity: Number(r.expired_quantity), value_usd: Number(r.value_usd), value_sos: Number(r.value_sos) })); } });
  const lots = useQuery({ queryKey: ['inventory', 'lots', storeId], enabled: tab === 'lots', queryFn: async () => {
    const { data, error } = await supabase.from('inventory_lots').select('id, lot_number, expiry_date, quantity_received, quantity_remaining, unit_cost, cost_currency, received_at, product:products(name)').eq('supermarket_id', storeId).gt('quantity_remaining', 0).order('expiry_date', { ascending: true, nullsFirst: false }).limit(300);
    if (error) throw error; return data as unknown as Lot[]; } });
  const moves = useQuery({ queryKey: ['movements', storeId], enabled: tab === 'movements', queryFn: async () => {
    const { data, error } = await supabase.from('stock_movements').select('id, movement_type, quantity, reason, created_at, product:products(name)').eq('supermarket_id', storeId).order('created_at', { ascending: false }).limit(100);
    if (error) throw error; return data as unknown as Array<{ id: string; movement_type: string; quantity: number; reason: string | null; created_at: string; product: { name: string } | null }>; } });

  const rows = (overview.data ?? []).filter((r) => {
    const t = search.trim().toLowerCase();
    if (t && !(r.name.toLowerCase().includes(t) || r.sku?.toLowerCase().includes(t) || r.barcode?.toLowerCase().includes(t))) return false;
    switch (filter) {
      case 'in': return r.available > 0; case 'out': return r.available <= 0; case 'low': return r.available > 0 && r.available <= r.min_stock;
      case 'expiring': return !!r.next_expiry && r.next_expiry <= warnBy; case 'expired': return r.expired_quantity > 0; default: return true;
    }
  });
  const totals = (overview.data ?? []).reduce((a, r) => ({ usd: a.usd + r.value_usd, sos: a.sos + r.value_sos }), { usd: 0, sos: 0 });
  const status = (r: Ov) => r.available <= 0 ? <Badge tone="red">Out of stock</Badge> : r.available <= r.min_stock ? <Badge tone="amber">Low</Badge> : <Badge tone="green">In stock</Badge>;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Inventory" subtitle={tab === 'products' && overview.data ? `Stock value: ${formatMoney(totals.usd, 'USD')} and ${formatMoney(totals.sos, 'SOS')} at purchase cost (shown separately by cost currency).` : 'Stock on hand, lots and movements.'}
        actions={<Link to="/receiving" className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"><PackagePlus className="h-4 w-4" />Receive stock</Link>} />
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {(['products', 'lots', 'movements'] as Tab[]).map((t) => <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium ${tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-900'}`}>{{ products: 'By product', lots: 'Lots and expiry', movements: 'Movements' }[t]}</button>)}
      </div>
      {tab === 'products' && <>
        <div className="mb-3 flex flex-wrap gap-2">{FILTERS.map((f) => <button key={f} onClick={() => { setFilter(f); setPage(0); }} className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${filter === f ? 'bg-brand-600 text-white' : 'bg-white text-ink-700 ring-1 ring-ink-300 hover:bg-slate-50'}`}>{FILTER_LABEL[f]}</button>)}</div>
        <div className="mb-3 max-w-sm"><Field aria-label="Search" placeholder="Search name, SKU or barcode" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} /></div>
        {overview.isLoading ? <TableSkeleton /> : overview.isError ? <ErrorState onRetry={() => void overview.refetch()} /> : rows.length === 0 ? <EmptyState title="Nothing matches" hint="Change the filter or receive stock." /> : <>
          <Table><thead><tr><Th>Product</Th><Th right>Available</Th><Th right>Minimum</Th><Th right>Value (USD cost)</Th><Th right>Value (SOS cost)</Th><Th>Next expiry</Th><Th>Status</Th></tr></thead>
            <tbody>{rows.slice(page * PAGE, page * PAGE + PAGE).map((r) => <tr key={r.product_id}>
              <Td><div className="font-medium">{r.name}</div><div className="text-xs text-ink-500">{r.barcode ?? r.sku ?? ''}</div></Td>
              <Td right>{formatQty(r.available)}{r.expired_quantity > 0 && <div className="text-xs text-red-600">+{formatQty(r.expired_quantity)} expired</div>}</Td>
              <Td right>{formatQty(r.min_stock)}</Td><Td right>{r.value_usd ? formatMoney(r.value_usd, 'USD') : '-'}</Td><Td right>{r.value_sos ? formatMoney(r.value_sos, 'SOS') : '-'}</Td>
              <Td>{r.next_expiry ? <span className={r.next_expiry <= warnBy ? 'font-medium text-amber-700' : ''}>{formatDate(r.next_expiry)}</span> : '-'}</Td><Td>{status(r)}</Td></tr>)}</tbody></Table>
          <Pagination page={page} pageSize={PAGE} total={rows.length} onChange={setPage} /></>}
      </>}
      {tab === 'lots' && (lots.isLoading ? <TableSkeleton /> : lots.isError ? <ErrorState onRetry={() => void lots.refetch()} /> : lots.data!.length === 0 ? <EmptyState title="No stock lots" /> : (
        <Table><thead><tr><Th>Product</Th><Th>Lot</Th><Th>Received</Th><Th>Expiry</Th><Th right>Remaining</Th><Th right>Unit cost</Th>{activeRole === 'admin' && <Th right>Action</Th>}</tr></thead>
          <tbody>{lots.data!.map((l) => { const expired = !!l.expiry_date && l.expiry_date < todayISO(); const soon = !!l.expiry_date && !expired && l.expiry_date <= warnBy; return (
            <tr key={l.id}><Td className="font-medium">{l.product?.name}</Td><Td>{l.lot_number ?? '-'}</Td><Td>{formatDate(l.received_at)}</Td>
              <Td>{l.expiry_date ? <>{formatDate(l.expiry_date)} {expired ? <Badge tone="red">Expired</Badge> : soon ? <Badge tone="amber">Soon</Badge> : null}</> : '-'}</Td>
              <Td right>{formatQty(l.quantity_remaining)} / {formatQty(l.quantity_received)}</Td><Td right>{Number(l.unit_cost).toLocaleString()} {l.cost_currency}</Td>
              {activeRole === 'admin' && <Td right><Button variant="secondary" className="h-9" onClick={() => setAdjust(l)}>{expired ? 'Write off' : 'Adjust'}</Button></Td>}</tr>); })}</tbody></Table>))}
      {tab === 'movements' && (moves.isLoading ? <TableSkeleton /> : moves.isError ? <ErrorState onRetry={() => void moves.refetch()} /> : moves.data!.length === 0 ? <EmptyState title="No movements yet" /> : (
        <Table><thead><tr><Th>When</Th><Th>Product</Th><Th>Type</Th><Th right>Quantity</Th><Th>Reason</Th></tr></thead>
          <tbody>{moves.data!.map((m) => <tr key={m.id}><Td>{formatDateTime(m.created_at)}</Td><Td className="font-medium">{m.product?.name}</Td><Td><Badge>{m.movement_type.replace('_', ' ')}</Badge></Td><Td right><span className={Number(m.quantity) < 0 ? 'text-red-600' : 'text-green-700'}>{Number(m.quantity) > 0 ? '+' : ''}{formatQty(m.quantity)}</span></Td><Td>{m.reason ?? ''}</Td></tr>)}</tbody></Table>))}
      {adjust && <Adjust lot={adjust} onClose={() => setAdjust(null)} />}
    </div>
  );
}

function Adjust({ lot, onClose }: { lot: Lot; onClose: () => void }) {
  const expired = !!lot.expiry_date && lot.expiry_date < todayISO();
  const [qty, setQty] = useState(String(lot.quantity_remaining));
  const [reason, setReason] = useState(expired ? 'Expired - discarded' : '');
  const [writeOff, setWriteOff] = useState(expired);
  const ok = Number(qty) > 0 && Number(qty) <= Number(lot.quantity_remaining) && reason.trim().length >= 3;
  const save = useAction(() => rpc('adjust_lot', { p_lot: lot.id, p_quantity: Number(qty), p_reason: reason, p_write_off: writeOff }), { invalidate: ['inventory', 'movements', 'pos-catalog'], success: 'Stock updated', onDone: onClose });
  return (
    <Modal title={`${writeOff ? 'Write off' : 'Adjust'}: ${lot.product?.name}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-ink-500">Removes units from this lot. The change is recorded in the stock history and audit log and cannot be edited later.</p>
        <Field label={`Quantity to remove (max ${formatQty(lot.quantity_remaining)})`} type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} error={Number(qty) > Number(lot.quantity_remaining) ? 'More than is in the lot' : undefined} />
        <Field label="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={writeOff} onChange={(e) => setWriteOff(e.target.checked)} />Record as write-off (damaged or expired)</label>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!ok} loading={save.isPending} onClick={() => save.mutate(undefined)}>Confirm</Button></div>
      </div>
    </Modal>
  );
}
