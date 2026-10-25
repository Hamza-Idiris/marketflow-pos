import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import JsBarcode from 'jsbarcode';
import { Printer, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useStoreId } from '@/hooks/useStore';
import { Button, Card, Field } from '@/components/ui';
import { Alert } from '@/components/ui';
import { EmptyState, PageHeader, SelectField } from '@/components/kit';
import { formatMoney } from '@/lib/format';

interface P { id: string; name: string; sku: string | null; barcode: string | null; prices: Array<{ currency: 'USD' | 'SOS'; price: number }> }

function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    try { if (ref.current) JsBarcode(ref.current, value, { format: 'CODE128', height: 40, width: 1.6, fontSize: 12, margin: 0 }); setBad(false); } catch { setBad(true); }
  }, [value]);
  return bad ? <span className="text-xs text-red-600">Cannot draw this barcode</span> : <svg ref={ref} />;
}

export function LabelsPage() {
  const storeId = useStoreId();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<P | null>(null);
  const [count, setCount] = useState('1');
  const [priceCur, setPriceCur] = useState<'none' | 'USD' | 'SOS'>('none');
  const [queue, setQueue] = useState<Array<{ p: P; n: number }>>([]);
  const results = useQuery({
    queryKey: ['label-search', storeId, search],
    enabled: search.trim().length >= 1,
    queryFn: async () => {
      const term = search.replace(/[,()%]/g, ' ').trim();
      const { data, error } = await supabase.from('products').select('id, name, sku, barcode, prices:product_prices(currency, price)').eq('supermarket_id', storeId).eq('is_active', true)
        .or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`).limit(8);
      if (error) throw error;
      return data as unknown as P[];
    },
  });
  const n = Math.floor(Number(count));
  const add = () => { if (picked && picked.barcode && n >= 1 && n <= 200) { setQueue((q) => [...q.filter((x) => x.p.id !== picked.id), { p: picked, n }]); setPicked(null); setSearch(''); setCount('1'); } };
  const labels = queue.flatMap(({ p, n: k }) => Array.from({ length: k }, (_, i) => ({ p, key: `${p.id}-${i}` })));
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Barcode labels" subtitle="Choose products, set the number of labels and print." actions={<Button disabled={labels.length === 0} onClick={() => window.print()}><Printer className="h-4 w-4" />Print labels</Button>} />
      <div className="no-print grid gap-5 lg:grid-cols-[22rem_1fr]">
        <Card className="space-y-4">
          <div className="relative"><Search className="absolute left-3 top-9 h-5 w-5 text-ink-500" /><Field label="Find product" className="pl-10" placeholder="Name, SKU or barcode" value={search} onChange={(e) => { setSearch(e.target.value); setPicked(null); }} /></div>
          {search && !picked && (results.data?.length ? <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">{results.data.map((p) => <li key={p.id}><button className="w-full px-3 py-2.5 text-left text-sm hover:bg-slate-50" onClick={() => setPicked(p)}>{p.name}<span className="block text-xs text-ink-500">{p.barcode ?? 'No barcode'}</span></button></li>)}</ul> : results.isFetched && <p className="text-sm text-ink-500">No matching products.</p>)}
          {picked && (picked.barcode ? <>
            <p className="text-sm font-medium">{picked.name}</p>
            <Field label="Number of labels" type="number" min={1} max={200} value={count} onChange={(e) => setCount(e.target.value)} error={n >= 1 && n <= 200 ? undefined : 'Enter 1 to 200'} />
            <SelectField label="Show price" value={priceCur} onChange={(e) => setPriceCur(e.target.value as typeof priceCur)}><option value="none">No price</option><option value="USD">USD price</option><option value="SOS">SOS price</option></SelectField>
            <Button className="w-full" disabled={!(n >= 1 && n <= 200)} onClick={add}>Add to print list</Button>
          </> : <Alert tone="info">This product has no barcode. Edit the product to add one.</Alert>)}
        </Card>
        <div>
          <h2 className="mb-2 font-semibold">Print list</h2>
          {queue.length === 0 ? <EmptyState title="No labels queued" hint="Find a product on the left and add it." /> : (
            <ul className="space-y-2">{queue.map(({ p, n: k }) => <li key={p.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm"><span>{p.name} × {k}</span><button className="text-red-600 hover:underline" onClick={() => setQueue((q) => q.filter((x) => x.p.id !== p.id))}>Remove</button></li>)}</ul>
          )}
        </div>
      </div>
      {labels.length > 0 && (
        <div className="print-area mt-6 flex flex-wrap gap-2" aria-label="Label preview">
          {labels.map(({ p, key }) => {
            const price = priceCur === 'none' ? null : p.prices.find((x) => x.currency === priceCur)?.price;
            return (
              <div key={key} className="flex w-[50mm] flex-col items-center justify-center overflow-hidden rounded border border-dashed border-ink-300 bg-white p-1.5 text-center" style={{ breakInside: 'avoid' }}>
                <div className="w-full truncate text-[11px] font-semibold">{p.name}</div>
                <Barcode value={p.barcode!} />
                <div className="text-[10px] text-ink-700">{p.sku ? `SKU ${p.sku}` : ''}</div>
                {price !== null && price !== undefined && <div className="text-sm font-bold">{formatMoney(price, priceCur as 'USD' | 'SOS')}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
