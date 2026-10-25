import { useState } from 'react';
import { Printer } from 'lucide-react';
import toast from 'react-hot-toast';
import { rpc, dbMessage } from '@/lib/rpc';
import { Button } from '@/components/ui';
import { Badge } from '@/components/kit';
import { formatDateTime, formatMoney, formatQty, METHOD_LABEL } from '@/lib/format';
import type { ReceiptData } from '@/types/database';

export function Receipt({ data, reprint, onPrintRequested }: { data: ReceiptData; reprint: boolean; onPrintRequested?: () => void }) {
  const [width, setWidth] = useState<'58' | '80'>('80');
  const [busy, setBusy] = useState(false);
  const { sale, store } = data;
  const cur = sale.currency;
  const print = async () => {
    setBusy(true);
    try {
      // We can only record that printing was requested; browsers do not tell us whether paper came out.
      await rpc('log_receipt_print', { p_sale: sale.id, p_reprint: reprint });
      onPrintRequested?.();
      window.print();
    } catch (e) { toast.error(dbMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div>
      <div className="no-print mb-3 flex items-center justify-between gap-2">
        <div className="flex gap-1 text-sm">
          {(['58', '80'] as const).map((w) => <button key={w} onClick={() => setWidth(w)} className={`rounded-lg px-3 py-1.5 font-medium ${width === w ? 'bg-brand-600 text-white' : 'bg-slate-100 text-ink-700'}`}>{w} mm</button>)}
        </div>
        <Button onClick={print} loading={busy}><Printer className="h-4 w-4" />{reprint ? 'Reprint' : 'Print'}</Button>
      </div>
      <div className={`print-area receipt-${width} mx-auto bg-white p-3 font-mono text-[12px] leading-snug text-black ${width === '58' ? 'max-w-[58mm]' : 'max-w-[80mm]'} border border-slate-200`}>
        <div className="text-center">
          <div className="text-sm font-bold">{store.name}</div>
          {store.address && <div>{store.address}</div>}
          {store.phone && <div>{store.phone}</div>}
        </div>
        <hr className="my-2 border-dashed border-black" />
        <div className="flex justify-between"><span>Receipt</span><span>{sale.receipt_number}</span></div>
        <div className="flex justify-between"><span>Date</span><span>{formatDateTime(sale.created_at)}</span></div>
        <div className="flex justify-between"><span>Cashier</span><span>{data.cashier}</span></div>
        {sale.status !== 'completed' && <div className="mt-1 text-center font-bold uppercase">{sale.status.replace('_', ' ')}</div>}
        {reprint && <div className="mt-1 text-center font-bold">** REPRINT **</div>}
        <hr className="my-2 border-dashed border-black" />
        {data.items.map((i, k) => (
          <div key={k} className="mb-1">
            <div>{i.name}</div>
            <div className="flex justify-between"><span>{formatQty(i.quantity)} x {formatMoney(i.unit_price, cur)}</span><span>{formatMoney(Number(i.line_total) + Number(i.discount_amount), cur)}</span></div>
            {Number(i.discount_amount) > 0 && <div className="flex justify-between"><span>  Discount {Number(i.discount_pct)}%</span><span>-{formatMoney(i.discount_amount, cur)}</span></div>}
          </div>
        ))}
        <hr className="my-2 border-dashed border-black" />
        <div className="flex justify-between"><span>Subtotal</span><span>{formatMoney(sale.subtotal, cur)}</span></div>
        {Number(sale.discount_total) > 0 && <div className="flex justify-between"><span>Discounts</span><span>-{formatMoney(sale.discount_total, cur)}</span></div>}
        <div className="flex justify-between text-sm font-bold"><span>TOTAL ({cur})</span><span>{formatMoney(sale.total, cur)}</span></div>
        <hr className="my-2 border-dashed border-black" />
        {data.payments.map((p, k) => (
          <div key={k} className="mb-1">
            <div className="flex justify-between"><span>{METHOD_LABEL[p.method]}</span><span>{formatMoney(p.amount, p.currency)}</span></div>
            {p.currency !== cur && <div className="text-[11px]">  = {formatMoney(p.converted_amount, cur)} @ {Number(p.exchange_rate).toLocaleString()} SOS/USD</div>}
            {p.reference && <div className="text-[11px]">  Ref: {p.reference}</div>}
            {p.method !== 'cash' && <div className="text-[11px]">  Recorded manually, not verified with the provider</div>}
          </div>
        ))}
        <hr className="my-2 border-dashed border-black" />
        <div className="text-center">{store.footer}</div>
      </div>
      {data.print_count > 0 && <p className="no-print mt-2 text-center text-xs text-ink-500">Printing has been requested {data.print_count} time{data.print_count > 1 ? 's' : ''} for this receipt.</p>}
      <div className="no-print mt-2 text-center"><Badge tone="gray">Check the paper: the browser cannot confirm that a receipt printed.</Badge></div>
    </div>
  );
}
