import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PackageCheck, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useAction } from '@/hooks/useAction';
import { useStoreId } from '@/hooks/useStore';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button, Field } from '@/components/ui';
import { Badge, ConfirmDialog, EmptyState, ErrorState, Modal, PageHeader, SelectField, Table, TableSkeleton, Td, TextArea, Th } from '@/components/kit';
import { useSuppliers } from '@/features/suppliers/SuppliersPage';
import { formatDate, formatMoney, formatQty } from '@/lib/format';
import type { Currency } from '@/types/database';

type Status = 'draft' | 'ordered' | 'partially_received' | 'received' | 'cancelled';
interface PO {
  id: string; reference: string | null; status: Status; currency: Currency; notes: string | null; created_at: string; supplier_id: string;
  supplier: { name: string } | null;
  items: Array<{ id: string; product_id: string; quantity_ordered: number; quantity_received: number; unit_cost: number; product: { name: string } | null }>;
}
const TONE: Record<Status, 'gray' | 'blue' | 'amber' | 'green' | 'red'> = { draft: 'gray', ordered: 'blue', partially_received: 'amber', received: 'green', cancelled: 'red' };
const LABEL: Record<Status, string> = { draft: 'Draft', ordered: 'Ordered', partially_received: 'Partly received', received: 'Received', cancelled: 'Cancelled' };

export function PurchasesPage() {
  const storeId = useStoreId();
  const { activeRole } = useAuth();
  const isAdmin = activeRole === 'admin';
  const [editing, setEditing] = useState<PO | 'new' | null>(null);
  const [confirm, setConfirm] = useState<{ po: PO; to: 'ordered' | 'cancelled' } | null>(null);
  const q = useQuery({
    queryKey: ['purchase-orders', storeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('purchase_orders').select('id, reference, status, currency, notes, created_at, supplier_id, supplier:suppliers(name), items:purchase_order_items(id, product_id, quantity_ordered, quantity_received, unit_cost, product:products(name))')
        .eq('supermarket_id', storeId).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data as unknown as PO[];
    },
  });
  const setStatus = useAction((a: { po: PO; to: 'ordered' | 'cancelled' }) => rpc('set_po_status', { p_id: a.po.id, p_status: a.to }), { invalidate: ['purchase-orders'], success: 'Order updated', onDone: () => setConfirm(null) });
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Purchases" subtitle="Orders to suppliers. Receive stock against an order to keep costs and quantities accurate."
        actions={isAdmin ? <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" />New purchase order</Button> : undefined} />
      {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : q.data!.length === 0 ? <EmptyState title="No purchase orders yet" hint={isAdmin ? 'Create an order to track what you expect from a supplier.' : undefined} /> : (
        <Table>
          <thead><tr><Th>Order</Th><Th>Supplier</Th><Th>Items</Th><Th right>Value</Th><Th>Status</Th><Th right>Actions</Th></tr></thead>
          <tbody>{q.data!.map((po) => {
            const value = po.items.reduce((s, i) => s + Number(i.quantity_ordered) * Number(i.unit_cost), 0);
            return (
              <tr key={po.id}>
                <Td><div className="font-medium">{po.reference ?? 'No reference'}</div><div className="text-xs text-ink-500">{formatDate(po.created_at)}</div></Td>
                <Td>{po.supplier?.name}</Td>
                <Td>{po.items.map((i) => `${i.product?.name} (${formatQty(i.quantity_received)}/${formatQty(i.quantity_ordered)})`).join(', ')}</Td>
                <Td right>{formatMoney(value, po.currency)}</Td>
                <Td><Badge tone={TONE[po.status]}>{LABEL[po.status]}</Badge></Td>
                <Td right><div className="flex justify-end gap-2">
                  {isAdmin && po.status === 'draft' && <><Button variant="secondary" className="h-9" onClick={() => setEditing(po)}>Edit</Button><Button className="h-9" onClick={() => setConfirm({ po, to: 'ordered' })}>Mark ordered</Button></>}
                  {isAdmin && (po.status === 'draft' || po.status === 'ordered') && <Button variant="ghost" className="h-9" onClick={() => setConfirm({ po, to: 'cancelled' })}>Cancel</Button>}
                  {(po.status === 'ordered' || po.status === 'partially_received') && <Link to={`/receiving?po=${po.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-700"><PackageCheck className="h-4 w-4" />Receive</Link>}
                </div></Td>
              </tr>
            );
          })}</tbody>
        </Table>
      )}
      {editing && <PoForm storeId={storeId} po={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {confirm && <ConfirmDialog title={confirm.to === 'ordered' ? 'Mark as ordered?' : 'Cancel this order?'} danger={confirm.to === 'cancelled'} loading={setStatus.isPending}
        message={confirm.to === 'ordered' ? 'The order can no longer be edited, and stock can be received against it.' : 'The order will be closed and cannot be received.'}
        confirmLabel={confirm.to === 'ordered' ? 'Mark ordered' : 'Cancel order'} onConfirm={() => setStatus.mutate(confirm)} onClose={() => setConfirm(null)} />}
    </div>
  );
}

interface Line { product_id: string; quantity: string; cost: string }
function PoForm({ storeId, po, onClose }: { storeId: string; po: PO | null; onClose: () => void }) {
  const suppliers = useSuppliers(storeId);
  const products = useQuery({ queryKey: ['product-options', storeId], queryFn: async () => {
    const { data, error } = await supabase.from('products').select('id, name').eq('supermarket_id', storeId).eq('is_active', true).order('name'); if (error) throw error; return data as Array<{ id: string; name: string }>; } });
  const [supplier, setSupplier] = useState(po?.supplier_id ?? '');
  const [reference, setReference] = useState(po?.reference ?? '');
  const [currency, setCurrency] = useState<Currency>(po?.currency ?? 'USD');
  const [notes, setNotes] = useState(po?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(po ? po.items.map((i) => ({ product_id: i.product_id, quantity: String(i.quantity_ordered), cost: String(i.unit_cost) })) : [{ product_id: '', quantity: '', cost: '' }]);
  const valid = supplier && lines.length > 0 && lines.every((l) => l.product_id && Number(l.quantity) > 0 && l.cost !== '' && Number(l.cost) >= 0);
  const save = useAction(() => rpc('save_purchase_order', { p_store: storeId, p_id: po?.id ?? null, p_supplier: supplier, p_reference: reference, p_currency: currency, p_notes: notes,
    p_items: lines.map((l) => ({ product_id: l.product_id, quantity_ordered: Number(l.quantity), unit_cost: Number(l.cost) })) }), { invalidate: ['purchase-orders'], success: 'Order saved', onDone: onClose });
  const upd = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <Modal title={po ? 'Edit purchase order' : 'New purchase order'} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)}><option value="">Select supplier</option>{suppliers.data?.filter((s) => s.is_active || s.id === supplier).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>
          <Field label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <SelectField label="Cost currency" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}><option value="USD">USD</option><option value="SOS">SOS</option></SelectField>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_6rem_6rem_auto] items-end gap-2">
              <SelectField label={i === 0 ? 'Product' : undefined} aria-label="Product" value={l.product_id} onChange={(e) => upd(i, 'product_id', e.target.value)}><option value="">Select product</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectField>
              <Field label={i === 0 ? 'Quantity' : undefined} aria-label="Quantity" type="number" min={0} step="any" value={l.quantity} onChange={(e) => upd(i, 'quantity', e.target.value)} />
              <Field label={i === 0 ? 'Unit cost' : undefined} aria-label="Unit cost" type="number" min={0} step="any" value={l.cost} onChange={(e) => upd(i, 'cost', e.target.value)} />
              <Button variant="ghost" className="h-11 px-2" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button variant="secondary" className="h-9" onClick={() => setLines((ls) => [...ls, { product_id: '', quantity: '', cost: '' }])}><Plus className="h-4 w-4" />Add line</Button>
        </div>
        <TextArea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save order</Button></div>
      </div>
    </Modal>
  );
}
