import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useAction } from '@/hooks/useAction';
import { useStoreId } from '@/hooks/useStore';
import { useAuth } from '@/features/auth/AuthProvider';
import { Alert, Button, Card, Field } from '@/components/ui';
import { PageHeader, SelectField, TextArea } from '@/components/kit';
import { useSuppliers } from '@/features/suppliers/SuppliersPage';
import { todayISO } from '@/lib/format';
import type { Currency } from '@/types/database';

interface Opt { id: string; name: string; track_expiry: boolean }
interface Line { product_id: string; po_item_id?: string; quantity: string; cost: string; currency: Currency; lot: string; expiry: string; outstanding?: number }

export function ReceivingPage() {
  const storeId = useStoreId();
  const { activeRole } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const poId = params.get('po');
  const suppliers = useSuppliers(storeId);
  const products = useQuery({ queryKey: ['product-options-exp', storeId], queryFn: async () => {
    const { data, error } = await supabase.from('products').select('id, name, track_expiry').eq('supermarket_id', storeId).eq('is_active', true).order('name'); if (error) throw error; return data as Opt[]; } });
  const po = useQuery({ queryKey: ['po-receive', poId], enabled: !!poId, queryFn: async () => {
    const { data, error } = await supabase.from('purchase_orders').select('id, reference, supplier_id, currency, status, items:purchase_order_items(id, product_id, quantity_ordered, quantity_received, unit_cost)').eq('id', poId!).single();
    if (error) throw error; return data as unknown as { id: string; reference: string | null; supplier_id: string; currency: Currency; status: string; items: Array<{ id: string; product_id: string; quantity_ordered: number; quantity_received: number; unit_cost: number }> }; } });
  const [supplier, setSupplier] = useState('');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [override, setOverride] = useState(false);
  const [lines, setLines] = useState<Line[]>([{ product_id: '', quantity: '', cost: '', currency: 'USD', lot: '', expiry: '' }]);

  useEffect(() => {
    if (!po.data) return;
    setSupplier(po.data.supplier_id); setReference(po.data.reference ?? '');
    setLines(po.data.items.filter((i) => Number(i.quantity_ordered) > Number(i.quantity_received)).map((i) => ({
      product_id: i.product_id, po_item_id: i.id, quantity: String(Number(i.quantity_ordered) - Number(i.quantity_received)), cost: String(i.unit_cost), currency: po.data.currency, lot: '', expiry: '', outstanding: Number(i.quantity_ordered) - Number(i.quantity_received) })));
  }, [po.data]);

  const trackExpiry = (id: string) => products.data?.find((p) => p.id === id)?.track_expiry ?? false;
  const lineOk = (l: Line) => l.product_id && Number(l.quantity) > 0 && l.cost !== '' && Number(l.cost) >= 0 && (!trackExpiry(l.product_id) || (l.expiry && l.expiry >= todayISO())) && (!l.expiry || l.expiry >= todayISO());
  const valid = lines.length > 0 && lines.every(lineOk);
  const upd = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const receive = useAction(() => rpc('receive_stock', { p_store: storeId, p_supplier: supplier || null, p_po: poId, p_reference: reference, p_received_on: date, p_notes: notes, p_override: override,
    p_items: lines.map((l) => ({ product_id: l.product_id, po_item_id: l.po_item_id ?? null, quantity: Number(l.quantity), unit_cost: Number(l.cost), cost_currency: l.currency, lot_number: l.lot, expiry_date: l.expiry || null })) }),
    { invalidate: ['inventory', 'purchase-orders', 'pos-catalog', 'movements'], success: 'Stock received', onDone: () => nav('/inventory') });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Receive stock" subtitle={poId ? 'Receiving against a purchase order.' : 'Record goods delivered by a supplier.'} />
      <Card className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField label="Supplier" value={supplier} disabled={!!poId} onChange={(e) => setSupplier(e.target.value)}><option value="">Select supplier</option>{suppliers.data?.filter((s) => s.is_active || s.id === supplier).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>
          <Field label="Reference / invoice no." value={reference} onChange={(e) => setReference(e.target.value)} />
          <Field label="Receiving date" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-3">
          {lines.map((l, i) => (
            <div key={i} className="rounded-xl border border-slate-200 p-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_7rem_7rem_6rem]">
                <SelectField label="Product" value={l.product_id} disabled={!!l.po_item_id} onChange={(e) => upd(i, 'product_id', e.target.value)}><option value="">Select product</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectField>
                <Field label="Quantity" type="number" min={0} step="any" value={l.quantity} onChange={(e) => upd(i, 'quantity', e.target.value)} />
                <Field label="Unit cost" type="number" min={0} step="any" value={l.cost} onChange={(e) => upd(i, 'cost', e.target.value)} />
                <SelectField label="Currency" value={l.currency} onChange={(e) => upd(i, 'currency', e.target.value)}><option value="USD">USD</option><option value="SOS">SOS</option></SelectField>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <Field label="Lot / batch number" value={l.lot} onChange={(e) => upd(i, 'lot', e.target.value)} />
                <Field label={trackExpiry(l.product_id) ? 'Expiry date (required)' : 'Expiry date (optional)'} type="date" min={todayISO()} value={l.expiry} onChange={(e) => upd(i, 'expiry', e.target.value)} error={trackExpiry(l.product_id) && !l.expiry && l.product_id ? 'Required for this product' : undefined} />
                {!l.po_item_id && <Button variant="ghost" className="mt-6 h-11 px-2" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}
              </div>
              {l.outstanding !== undefined && Number(l.quantity) > l.outstanding && <p className="mt-2 text-sm text-amber-700">More than the {l.outstanding} still outstanding on the order.</p>}
            </div>
          ))}
          {!poId && <Button variant="secondary" className="h-9" onClick={() => setLines((ls) => [...ls, { product_id: '', quantity: '', cost: '', currency: 'USD', lot: '', expiry: '' }])}><Plus className="h-4 w-4" />Add product</Button>}
        </div>
        <TextArea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {poId && activeRole === 'admin' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={override} onChange={(e) => setOverride(e.target.checked)} />Allow receiving more than the outstanding order quantity (admin override)</label>}
        {poId && po.data && po.data.items.every((i) => Number(i.quantity_ordered) <= Number(i.quantity_received)) && <Alert tone="info">Everything on this order has already been received.</Alert>}
        <div className="flex justify-end"><Button disabled={!valid} loading={receive.isPending} onClick={() => receive.mutate(undefined)}>Receive stock</Button></div>
      </Card>
    </div>
  );
}
