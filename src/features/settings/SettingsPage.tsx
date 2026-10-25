import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useAction } from '@/hooks/useAction';
import { useStoreId } from '@/hooks/useStore';
import { Button, Card, Field, Skeleton } from '@/components/ui';
import { ErrorState, PageHeader, TextArea } from '@/components/kit';
import { formatDateTime } from '@/lib/format';

export function SettingsPage() {
  const storeId = useStoreId();
  const q = useQuery({
    queryKey: ['settings', storeId],
    queryFn: async () => {
      const [s, st, r] = await Promise.all([
        supabase.from('supermarkets').select('name, phone, email, address').eq('id', storeId).single(),
        supabase.from('store_settings').select('expiry_warning_days, receipt_footer').eq('supermarket_id', storeId).single(),
        supabase.from('exchange_rates').select('id, sos_per_usd, created_at').eq('supermarket_id', storeId).order('created_at', { ascending: false }).limit(5),
      ]);
      if (s.error) throw s.error; if (st.error) throw st.error; if (r.error) throw r.error;
      return { store: s.data, settings: st.data, rates: r.data };
    },
  });
  const [f, setF] = useState({ name: '', phone: '', email: '', address: '', days: '30', footer: '', rate: '' });
  useEffect(() => {
    if (q.data) setF((p) => ({ ...p, name: q.data.store.name, phone: q.data.store.phone ?? '', email: q.data.store.email ?? '', address: q.data.store.address ?? '', days: String(q.data.settings.expiry_warning_days), footer: q.data.settings.receipt_footer }));
  }, [q.data]);
  const saveStore = useAction(() => rpc('update_supermarket_details', { p_id: storeId, p_name: f.name, p_phone: f.phone, p_email: f.email, p_address: f.address }), { invalidate: ['settings'], success: 'Store details saved' });
  const saveSettings = useAction(() => rpc('update_store_settings', { p_store: storeId, p_expiry_days: Number(f.days), p_footer: f.footer }), { invalidate: ['settings'], success: 'Settings saved' });
  const saveRate = useAction(() => rpc('set_exchange_rate', { p_store: storeId, p_sos_per_usd: Number(f.rate) }), { invalidate: ['settings'], success: 'Exchange rate saved', onDone: () => setF((p) => ({ ...p, rate: '' })) });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  if (q.isLoading) return <Skeleton className="h-64 w-full max-w-2xl" />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const days = Number(f.days);
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="Settings" />
      <Card className="space-y-4">
        <h2 className="font-semibold">Store details (shown on receipts)</h2>
        <Field label="Name" value={f.name} onChange={set('name')} />
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Phone" value={f.phone} onChange={set('phone')} /><Field label="Email" value={f.email} onChange={set('email')} /></div>
        <Field label="Address" value={f.address} onChange={set('address')} />
        <Button disabled={f.name.trim().length < 2} loading={saveStore.isPending} onClick={() => saveStore.mutate(undefined)}>Save details</Button>
      </Card>
      <Card className="space-y-4">
        <h2 className="font-semibold">Receipts and alerts</h2>
        <Field label="Warn about expiry (days before)" type="number" min={1} max={365} value={f.days} onChange={set('days')} error={days >= 1 && days <= 365 ? undefined : 'Enter 1 to 365'} />
        <TextArea label="Receipt thank-you message" value={f.footer} onChange={set('footer')} />
        <Button disabled={!(days >= 1 && days <= 365)} loading={saveSettings.isPending} onClick={() => saveSettings.mutate(undefined)}>Save settings</Button>
      </Card>
      <Card className="space-y-4">
        <h2 className="font-semibold">Exchange rate</h2>
        <p className="text-sm text-ink-500">Convention: how many SOS equal 1 USD. Each sale stores the rate used, so changing it never alters past receipts.</p>
        <div className="flex items-end gap-3">
          <div className="flex-1"><Field label="New rate (SOS per 1 USD)" type="number" min={0} step="0.01" value={f.rate} onChange={set('rate')} /></div>
          <Button disabled={!(Number(f.rate) > 0)} loading={saveRate.isPending} onClick={() => saveRate.mutate(undefined)}>Save rate</Button>
        </div>
        {q.data!.rates.length === 0 ? <p className="text-sm text-amber-700">No rate set yet. Mixed-currency payments cannot be used until you set one.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {q.data!.rates.map((r, i) => <li key={r.id} className="flex justify-between py-2"><span>{Number(r.sos_per_usd).toLocaleString()} SOS / USD{i === 0 && <span className="ml-2 text-xs font-medium text-green-700">current</span>}</span><span className="text-ink-500">{formatDateTime(r.created_at)}</span></li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}
