import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Minus, Package, Plus, ScanBarcode, ShoppingCart, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useAction } from '@/hooks/useAction';
import { useStoreId } from '@/hooks/useStore';
import { useAuth } from '@/features/auth/AuthProvider';
import { Alert, Button, Skeleton } from '@/components/ui';
import { ConfirmDialog, EmptyState, ErrorState, Modal } from '@/components/kit';
import { Receipt } from '@/features/sales/Receipt';
import { useOpenShift } from '@/features/shifts/useShift';
import { imageUrl } from '@/features/products/ProductsPage';
import { formatMoney, formatQty, METHOD_LABEL } from '@/lib/format';
import { convert, lineTotals, roundMoney, sameAmount } from '@/lib/money';
import type { Currency, PaymentMethod, PosProduct, ReceiptData } from '@/types/database';

interface CartLine { product: PosProduct; qty: number; discount: number }
const priceOf = (p: PosProduct, c: Currency) => (c === 'USD' ? p.usd_price : p.sos_price);

export function PosPage() {
  const storeId = useStoreId();
  const { activeStore } = useAuth();
  const maxDiscount = activeStore?.cashier_max_discount_pct ?? 0;
  const shift = useOpenShift(storeId);
  const [currency, setCurrency] = useState<Currency>('USD');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [clearing, setClearing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const catalog = useQuery({ queryKey: ['pos-catalog', storeId], queryFn: async () => (await rpc<PosProduct[]>('pos_catalog', { p_store: storeId })).map((p) => ({ ...p, available: Number(p.available), usd_price: p.usd_price === null ? null : Number(p.usd_price), sos_price: p.sos_price === null ? null : Number(p.sos_price) })) });
  const cats = useQuery({ queryKey: ['pos-categories', storeId], queryFn: async () => { const { data, error } = await supabase.from('categories').select('id, name').eq('supermarket_id', storeId).eq('is_active', true).order('name'); if (error) throw error; return data as Array<{ id: string; name: string }>; } });

  useEffect(() => { searchRef.current?.focus(); const h = (e: KeyboardEvent) => { if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); searchRef.current?.focus(); } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);

  const inCart = (id: string) => cart.find((l) => l.product.product_id === id)?.qty ?? 0;
  const add = (p: PosProduct, n = 1) => {
    if (priceOf(p, currency) === null) return toast.error(`${p.name} has no ${currency} price`);
    if (inCart(p.product_id) + n > p.available) return toast.error(`Only ${formatQty(p.available)} of ${p.name} in stock`);
    setCart((c) => c.some((l) => l.product.product_id === p.product_id) ? c.map((l) => l.product.product_id === p.product_id ? { ...l, qty: l.qty + n } : l) : [...c, { product: p, qty: n, discount: 0 }]);
  };
  const setQty = (id: string, qty: number) => setCart((c) => c.map((l) => {
    if (l.product.product_id !== id) return l;
    if (qty > l.product.available) { toast.error(`Only ${formatQty(l.product.available)} in stock`); return { ...l, qty: l.product.available }; }
    return { ...l, qty };
  }));
  const setDiscount = (id: string, d: number) => setCart((c) => c.map((l) => (l.product.product_id === id ? { ...l, discount: Math.min(Math.max(d, 0), maxDiscount) } : l)));

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (catalog.data ?? []).filter((p) => (!category || p.category_id === category) && (!t || p.name.toLowerCase().includes(t) || p.barcode?.toLowerCase() === t || p.sku?.toLowerCase().includes(t) || p.barcode?.toLowerCase().includes(t)));
  }, [catalog.data, search, category]);

  // USB scanners type the code then press Enter; an exact barcode adds the item immediately.
  const onSearchEnter = () => {
    const t = search.trim().toLowerCase(); if (!t) return;
    const exact = (catalog.data ?? []).find((p) => p.barcode?.toLowerCase() === t || p.sku?.toLowerCase() === t);
    const target = exact ?? (filtered.length === 1 ? filtered[0] : undefined);
    if (target) { add(target); setSearch(''); } else toast.error('No single product matches. Refine the search.');
  };

  const totals = cart.reduce((a, l) => { const p = priceOf(l.product, currency) ?? 0; const t = lineTotals(l.qty, p, l.discount, currency); return { sub: a.sub + t.subtotal, disc: a.disc + t.discount, total: a.total + t.total }; }, { sub: 0, disc: 0, total: 0 });
  const total = roundMoney(totals.total, currency);

  // Switching currency re-prices the cart; drop items that have no price in the new currency.
  const switchCurrency = (c: Currency) => {
    if (c === currency) return;
    const missing = cart.filter((l) => priceOf(l.product, c) === null);
    if (missing.length) toast(`Removed without a ${c} price: ${missing.map((m) => m.product.name).join(', ')}`);
    setCart((x) => x.filter((l) => priceOf(l.product, c) !== null)); setCurrency(c);
  };

  if (shift.isLoading || catalog.isLoading) return <Skeleton className="h-[70vh] w-full" />;
  if (shift.isError || catalog.isError) return <ErrorState onRetry={() => { void shift.refetch(); void catalog.refetch(); }} />;
  if (!shift.data) return (
    <div className="mx-auto max-w-lg pt-10"><EmptyState title="Open a shift to start selling" hint="Sales are recorded against your shift so your cash can be reconciled."
      action={<Link to="/shifts" className="inline-flex h-11 items-center rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700">Open shift</Link>} /></div>
  );

  return (
    <div className="grid h-[calc(100vh-7rem)] min-h-[34rem] gap-4 lg:grid-cols-[26rem_1fr]">
      {/* Cart */}
      <section className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-card" aria-label="Cart">
        <div className="flex items-center justify-between border-b border-slate-100 p-4"><h2 className="flex items-center gap-2 font-semibold"><ShoppingCart className="h-5 w-5" />Cart</h2>
          {cart.length > 0 && <button className="text-sm text-red-600 hover:underline" onClick={() => setClearing(true)}>Clear</button>}</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {cart.length === 0 ? <p className="p-8 text-center text-sm text-ink-500">Scan a barcode or tap a product to begin.</p> : cart.map((l) => {
            const p = priceOf(l.product, currency) ?? 0; const t = lineTotals(l.qty, p, l.discount, currency);
            return (
              <div key={l.product.product_id} className="rounded-lg p-3 hover:bg-slate-50">
                <div className="flex justify-between gap-2"><span className="font-medium">{l.product.name}</span><button aria-label={`Remove ${l.product.name}`} onClick={() => setCart((c) => c.filter((x) => x !== l))} className="text-ink-500 hover:text-red-600"><Trash2 className="h-4 w-4" /></button></div>
                <div className="mt-1 text-xs text-ink-500">{formatMoney(p, currency)} each</div>
                <div className="mt-2 flex items-center gap-2">
                  <Button variant="secondary" className="h-10 w-10 px-0" aria-label="Decrease" onClick={() => l.qty > 1 ? setQty(l.product.product_id, l.qty - 1) : setCart((c) => c.filter((x) => x !== l))}><Minus className="h-4 w-4" /></Button>
                  <input aria-label="Quantity" inputMode="decimal" className="h-10 w-16 rounded-lg border border-ink-300 text-center text-sm" value={l.qty} onChange={(e) => { const v = Number(e.target.value); if (v > 0 && v === Math.round(v * 1000) / 1000) setQty(l.product.product_id, v); }} />
                  <Button variant="secondary" className="h-10 w-10 px-0" aria-label="Increase" onClick={() => add(l.product)}><Plus className="h-4 w-4" /></Button>
                  {maxDiscount > 0 && <label className="ml-auto flex items-center gap-1 text-xs text-ink-500">Disc %<input aria-label="Discount percent" inputMode="decimal" className="h-10 w-16 rounded-lg border border-ink-300 text-center text-sm text-ink-900" value={l.discount || ''} placeholder="0" onChange={(e) => setDiscount(l.product.product_id, Number(e.target.value) || 0)} /></label>}
                  <span className={`${maxDiscount > 0 ? '' : 'ml-auto'} min-w-[5rem] text-right font-semibold tabular-nums`}>{formatMoney(t.total, currency)}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-slate-100 p-4">
          <div className="flex justify-between text-sm text-ink-500"><span>Subtotal</span><span>{formatMoney(totals.sub, currency)}</span></div>
          {totals.disc > 0 && <div className="flex justify-between text-sm text-ink-500"><span>Discounts</span><span>-{formatMoney(totals.disc, currency)}</span></div>}
          <div className="mt-1 flex justify-between text-xl font-semibold"><span>Total</span><span className="tabular-nums">{formatMoney(total, currency)}</span></div>
          <Button className="mt-3 h-14 w-full text-base" disabled={cart.length === 0 || total <= 0} onClick={() => setPaying(true)}>Charge {formatMoney(total, currency)}</Button>
          {maxDiscount > 0 && <p className="mt-2 text-center text-xs text-ink-500">Your discount limit is {maxDiscount}%</p>}
        </div>
      </section>

      {/* Catalog */}
      <section className="flex min-h-0 flex-col gap-3" aria-label="Products">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[14rem] flex-1"><ScanBarcode className="absolute left-3 top-3 h-5 w-5 text-ink-500" />
            <input ref={searchRef} aria-label="Scan barcode or search products" placeholder="Scan barcode or search (press / to focus)" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onSearchEnter()}
              className="h-12 w-full rounded-xl border border-ink-300 bg-white pl-10 pr-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100" /></div>
          <div className="flex rounded-xl bg-white p-1 ring-1 ring-ink-300" role="group" aria-label="Sale currency">{(['USD', 'SOS'] as Currency[]).map((c) => <button key={c} onClick={() => switchCurrency(c)} aria-pressed={currency === c} className={`h-10 rounded-lg px-4 text-sm font-semibold ${currency === c ? 'bg-brand-600 text-white' : 'text-ink-700'}`}>{c}</button>)}</div>
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">Shift open</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setCategory('')} className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${!category ? 'bg-brand-600 text-white' : 'bg-white ring-1 ring-ink-300'}`}>All</button>
          {cats.data?.map((c) => <button key={c.id} onClick={() => setCategory(c.id)} className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${category === c.id ? 'bg-brand-600 text-white' : 'bg-white ring-1 ring-ink-300'}`}>{c.name}</button>)}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? <EmptyState title="No products found" hint="Check the spelling or clear the category filter." /> : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {filtered.map((p) => { const price = priceOf(p, currency); const out = p.available <= 0; const low = !out && p.available <= p.min_stock; const disabled = out || price === null;
                return (
                  <button key={p.product_id} disabled={disabled} onClick={() => add(p)} className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-card transition hover:border-brand-500 disabled:cursor-not-allowed disabled:opacity-50">
                    <div className="grid h-24 place-items-center bg-slate-100">{p.image_path ? <img src={imageUrl(p.image_path)!} alt="" className="h-full w-full object-cover" /> : <Package className="h-8 w-8 text-ink-300" />}</div>
                    <div className="p-3"><div className="line-clamp-2 text-sm font-medium leading-tight">{p.name}</div>
                      <div className="mt-1 font-semibold text-brand-700">{price === null ? `No ${currency} price` : formatMoney(price, currency)}</div>
                      <div className={`text-xs ${out ? 'text-red-600' : low ? 'text-amber-700' : 'text-ink-500'}`}>{out ? 'Out of stock' : `${formatQty(p.available)} available${low ? ' (low)' : ''}`}</div></div>
                  </button>); })}
            </div>)}
        </div>
      </section>

      {clearing && <ConfirmDialog title="Clear the cart?" message="All items will be removed from this sale." confirmLabel="Clear cart" danger onConfirm={() => { setCart([]); setClearing(false); }} onClose={() => setClearing(false)} />}
      {paying && <PaymentModal storeId={storeId} shiftId={shift.data.id} currency={currency} total={total} cart={cart} onClose={() => setPaying(false)}
        onDone={(r) => { setPaying(false); setCart([]); setReceipt(r); void catalog.refetch(); }} />}
      {receipt && <Modal title="Sale complete" onClose={() => { setReceipt(null); searchRef.current?.focus(); }}><Receipt data={receipt} reprint={false} /></Modal>}
    </div>
  );
}

interface PayRow { id: number; method: PaymentMethod; currency: Currency; amount: string; reference: string }

function PaymentModal({ storeId, shiftId, currency, total, cart, onClose, onDone }: { storeId: string; shiftId: string; currency: Currency; total: number; cart: CartLine[]; onClose: () => void; onDone: (r: ReceiptData) => void }) {
  const rate = useQuery({ queryKey: ['rate', storeId], queryFn: async () => { const { data, error } = await supabase.from('exchange_rates').select('sos_per_usd').eq('supermarket_id', storeId).order('created_at', { ascending: false }).limit(1); if (error) throw error; return data[0] ? Number(data[0].sos_per_usd) : null; } });
  const [rows, setRows] = useState<PayRow[]>([{ id: 1, method: 'cash', currency, amount: String(total), reference: '' }]);
  const key = useRef(crypto.randomUUID()); // one key per checkout attempt: a retry cannot create a second sale
  const r = rate.data ?? null;
  const conv = rows.map((x) => { const a = Number(x.amount); return a > 0 ? convert(a, x.currency, currency, r) : 0; });
  const noRate = rows.some((x, i) => x.currency !== currency && conv[i] === null);
  const paid = conv.reduce<number>((s, c) => s + (c ?? 0), 0);
  const exact = !noRate && sameAmount(paid, total, currency);
  const remaining = roundMoney(total - paid, currency);
  const upd = (id: number, patch: Partial<PayRow>) => setRows((rs) => rs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const amountOk = rows.every((x) => Number(x.amount) > 0 && Number(x.amount) === roundMoney(Number(x.amount), x.currency));

  const pay = useAction(() => rpc<ReceiptData>('checkout', { p_store: storeId, p_shift: shiftId, p_currency: currency, p_idempotency_key: key.current,
    p_items: cart.map((l) => ({ product_id: l.product.product_id, quantity: l.qty, discount_pct: l.discount })),
    p_payments: rows.map((x) => ({ method: x.method, amount: Number(x.amount), currency: x.currency, reference: x.reference.trim() || null })) }),
    { invalidate: ['shift-summary', 'sales'], success: 'Sale recorded', onDone });

  return (
    <Modal title={`Payment: ${formatMoney(total, currency)}`} onClose={onClose} wide>
      <div className="space-y-3">
        {rows.map((x, i) => (
          <div key={x.id} className="rounded-xl border border-slate-200 p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_6rem_1fr]">
              <select aria-label="Payment method" value={x.method} onChange={(e) => upd(x.id, { method: e.target.value as PaymentMethod })} className="h-11 rounded-xl border border-ink-300 bg-white px-3 text-sm">{(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</select>
              <select aria-label="Payment currency" value={x.currency} onChange={(e) => upd(x.id, { currency: e.target.value as Currency })} className="h-11 rounded-xl border border-ink-300 bg-white px-3 text-sm"><option>USD</option><option>SOS</option></select>
              <input aria-label="Amount" inputMode="decimal" value={x.amount} onChange={(e) => upd(x.id, { amount: e.target.value })} className="h-11 rounded-xl border border-ink-300 px-3 text-right text-sm tabular-nums" />
            </div>
            {x.method !== 'cash' && <input aria-label="Transaction reference" placeholder="Transaction reference (optional)" value={x.reference} onChange={(e) => upd(x.id, { reference: e.target.value })} className="mt-2 h-10 w-full rounded-xl border border-ink-300 px-3 text-sm" />}
            <div className="mt-1 flex items-center justify-between text-xs text-ink-500">
              <span>{x.method !== 'cash' ? 'Confirm the money arrived on your phone first. It is recorded manually, not verified.' : ''}{x.currency !== currency && conv[i] !== null ? ` = ${formatMoney(conv[i], currency)} at ${r?.toLocaleString()} SOS/USD` : ''}</span>
              {rows.length > 1 && <button className="text-red-600 hover:underline" onClick={() => setRows((rs) => rs.filter((y) => y.id !== x.id))}>Remove</button>}
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="h-9" onClick={() => setRows((rs) => [...rs, { id: Math.max(...rs.map((y) => y.id)) + 1, method: 'cash', currency, amount: remaining > 0 ? String(remaining) : '', reference: '' }])}>Add split payment</Button>
        </div>
        {noRate && <Alert>No exchange rate is set. Ask your admin to set one in Settings before taking payment in the other currency.</Alert>}
        <div className={`rounded-xl px-4 py-3 text-sm ${exact ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}>
          Paid {formatMoney(paid, currency)} of {formatMoney(total, currency)}. {exact ? 'Ready to complete.' : remaining > 0 ? `${formatMoney(remaining, currency)} still to collect.` : `${formatMoney(-remaining, currency)} too much. Payments must match the total exactly.`}
        </div>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Back</Button><Button className="h-12 px-6" disabled={!exact || !amountOk} loading={pay.isPending} onClick={() => pay.mutate(undefined)}>Complete sale</Button></div>
      </div>
    </Modal>
  );
}
