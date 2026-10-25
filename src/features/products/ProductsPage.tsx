import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Archive, ImageIcon, Package, Pencil, Plus, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAction } from '@/hooks/useAction';
import { useStoreId } from '@/hooks/useStore';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button, Field } from '@/components/ui';
import { Badge, ConfirmDialog, EmptyState, ErrorState, Modal, PageHeader, Pagination, SelectField, Table, TableSkeleton, Td, Th } from '@/components/kit';
import { formatMoney } from '@/lib/format';
import type { Category, Unit } from '@/types/database';

const PAGE = 15;
interface Row {
  id: string; name: string; sku: string | null; barcode: string | null; image_path: string | null; min_stock: number; track_expiry: boolean; is_active: boolean;
  category_id: string | null; unit_id: string | null;
  prices: Array<{ currency: 'USD' | 'SOS'; price: number }>; category: { name: string } | null;
}

export const imageUrl = (path: string | null) => (path ? supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl : null);

export function useCatalogLookups(storeId: string) {
  return useQuery({
    queryKey: ['lookups', storeId],
    queryFn: async () => {
      const [c, u] = await Promise.all([
        supabase.from('categories').select('id, name, is_active').eq('supermarket_id', storeId).order('name'),
        supabase.from('units').select('id, name, abbreviation').eq('supermarket_id', storeId).order('name'),
      ]);
      if (c.error) throw c.error; if (u.error) throw u.error;
      return { categories: c.data as Category[], units: u.data as Unit[] };
    },
  });
}

export function ProductsPage() {
  const storeId = useStoreId();
  const canEdit = useAuth().activeRole === 'admin';
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active');
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Row | null>(null);
  const lookups = useCatalogLookups(storeId);

  const q = useQuery({
    queryKey: ['products', storeId, page, search, category, status],
    queryFn: async () => {
      let query = supabase.from('products').select('id, name, sku, barcode, image_path, min_stock, track_expiry, is_active, category_id, unit_id, prices:product_prices(currency, price), category:categories(name)', { count: 'exact' })
        .eq('supermarket_id', storeId).order('name').range(page * PAGE, page * PAGE + PAGE - 1);
      const term = search.replace(/[,()%]/g, ' ').trim();
      if (term) query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`);
      if (category) query = query.eq('category_id', category);
      if (status !== 'all') query = query.eq('is_active', status === 'active');
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data as unknown as Row[], total: count ?? 0 };
    },
  });
  const toggle = useAction(async (r: Row) => { const { error } = await supabase.from('products').update({ is_active: !r.is_active }).eq('id', r.id); if (error) throw error; },
    { invalidate: ['products', 'pos-catalog'], success: 'Product updated', onDone: () => setArchiving(null) });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Products" subtitle="Everything you sell, with prices in each currency."
        actions={canEdit ? <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" />New product</Button> : undefined} />
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_12rem_10rem]">
        <div className="relative"><Search className="absolute left-3 top-3 h-5 w-5 text-ink-500" />
          <input aria-label="Search products" placeholder="Search name, SKU or barcode" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="h-11 w-full rounded-xl border border-ink-300 bg-white pl-10 pr-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100" /></div>
        <SelectField aria-label="Category" value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }}><option value="">All categories</option>{lookups.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>
        <SelectField aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(0); }}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></SelectField>
      </div>
      {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : q.data!.rows.length === 0 ? (
        <EmptyState title="No products found" hint={search || category ? 'Try a different search or filter.' : 'Add your first product to start selling.'} />
      ) : (
        <>
          <Table>
            <thead><tr><Th>Product</Th><Th>Barcode / SKU</Th><Th>Category</Th><Th right>USD</Th><Th right>SOS</Th><Th>Status</Th>{canEdit && <Th right>Actions</Th>}</tr></thead>
            <tbody>
              {q.data!.rows.map((r) => {
                const usd = r.prices.find((p) => p.currency === 'USD')?.price; const sos = r.prices.find((p) => p.currency === 'SOS')?.price;
                return (
                  <tr key={r.id}>
                    <Td><div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-slate-100">{r.image_path ? <img src={imageUrl(r.image_path)!} alt="" className="h-full w-full object-cover" /> : <Package className="h-5 w-5 text-ink-300" />}</span>
                      <span className="font-medium">{r.name}</span></div></Td>
                    <Td><div>{r.barcode ?? '-'}</div><div className="text-xs text-ink-500">{r.sku ?? ''}</div></Td>
                    <Td>{r.category?.name ?? '-'}</Td>
                    <Td right>{usd !== undefined ? formatMoney(usd, 'USD') : <span className="text-ink-300">none</span>}</Td>
                    <Td right>{sos !== undefined ? formatMoney(sos, 'SOS') : <span className="text-ink-300">none</span>}</Td>
                    <Td><Badge tone={r.is_active ? 'green' : 'gray'}>{r.is_active ? 'Active' : 'Archived'}</Badge></Td>
                    {canEdit && <Td right><div className="flex justify-end gap-1">
                      <Button variant="ghost" className="h-9 px-2" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" className="h-9 px-2" aria-label={r.is_active ? `Archive ${r.name}` : `Restore ${r.name}`} onClick={() => setArchiving(r)}><Archive className="h-4 w-4" /></Button>
                    </div></Td>}
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={PAGE} total={q.data!.total} onChange={setPage} />
        </>
      )}
      {editing && <ProductForm storeId={storeId} product={editing === 'new' ? null : editing} lookups={lookups.data} onClose={() => setEditing(null)} />}
      {archiving && <ConfirmDialog title={archiving.is_active ? 'Archive product?' : 'Restore product?'} loading={toggle.isPending}
        message={archiving.is_active ? `${archiving.name} will no longer appear in the POS. Past sales and stock history are kept.` : `${archiving.name} will be available in the POS again.`}
        confirmLabel={archiving.is_active ? 'Archive' : 'Restore'} onConfirm={() => toggle.mutate(archiving)} onClose={() => setArchiving(null)} />}
    </div>
  );
}

const price = z.string().trim().refine((v) => v === '' || (/^\d+(\.\d{1,2})?$/.test(v)), 'Use a number like 2.50');
const schema = z.object({
  name: z.string().trim().min(1, 'Enter the product name'),
  sku: z.string().trim().optional(), barcode: z.string().trim().optional(),
  category_id: z.string().optional(), unit_id: z.string().optional(),
  usd: price, sos: z.string().trim().refine((v) => v === '' || /^\d+$/.test(v), 'Whole SOS amounts only'),
  min_stock: z.coerce.number().min(0, 'Cannot be negative'),
  track_expiry: z.boolean(), is_active: z.boolean(),
}).refine((v) => v.usd !== '' || v.sos !== '', { path: ['usd'], message: 'Set at least one price' });

function ProductForm({ storeId, product, lookups, onClose }: { storeId: string; product: Row | null; lookups?: { categories: Category[]; units: Unit[] }; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors } } = useForm<z.input<typeof schema>, unknown, z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: product?.name ?? '', sku: product?.sku ?? '', barcode: product?.barcode ?? '', category_id: product?.category_id ?? '', unit_id: product?.unit_id ?? '',
      usd: product?.prices.find((p) => p.currency === 'USD')?.price?.toString() ?? '', sos: product?.prices.find((p) => p.currency === 'SOS')?.price?.toString() ?? '',
      min_stock: product?.min_stock ?? 0, track_expiry: product?.track_expiry ?? false, is_active: product?.is_active ?? true,
    },
  });
  const save = useAction(async (v: z.infer<typeof schema>) => {
    const payload = { supermarket_id: storeId, name: v.name, sku: v.sku || null, barcode: v.barcode || null, category_id: v.category_id || null, unit_id: v.unit_id || null, min_stock: v.min_stock, track_expiry: v.track_expiry, is_active: v.is_active };
    const res = product ? await supabase.from('products').update(payload).eq('id', product.id).select('id').single() : await supabase.from('products').insert(payload).select('id').single();
    if (res.error) throw new Error(res.error.message);
    const id = res.data.id as string;
    const prices = [v.usd !== '' && { supermarket_id: storeId, product_id: id, currency: 'USD', price: Number(v.usd) }, v.sos !== '' && { supermarket_id: storeId, product_id: id, currency: 'SOS', price: Number(v.sos) }].filter(Boolean);
    const p = await supabase.from('product_prices').upsert(prices as object[], { onConflict: 'product_id,currency' });
    if (p.error) throw new Error(p.error.message);
    if (file) {
      const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = `${storeId}/${id}.${ext}`;
      const up = await supabase.storage.from('product-images').upload(path, file, { upsert: true, contentType: file.type });
      if (up.error) throw new Error('The product was saved but the image could not be uploaded.');
      const u = await supabase.from('products').update({ image_path: `${path}?v=${Date.now()}` }).eq('id', id);
      if (u.error) throw new Error(u.error.message);
    }
  }, { invalidate: ['products', 'pos-catalog', 'inventory'], success: 'Product saved', onDone: onClose });
  const onFile = (f: File | undefined) => {
    setFileError(null);
    if (!f) return setFile(null);
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) { setFileError('Use a PNG, JPG or WebP image'); return setFile(null); }
    if (f.size > 2 * 1024 * 1024) { setFileError('Image must be under 2 MB'); return setFile(null); }
    setFile(f);
  };
  return (
    <Modal title={product ? 'Edit product' : 'New product'} onClose={onClose} wide>
      <form className="space-y-4" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label="Name" error={errors.name?.message} {...register('name')} />
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Barcode" {...register('barcode')} /><Field label="SKU" {...register('sku')} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Category" {...register('category_id')}><option value="">None</option>{lookups?.categories.filter((c) => c.is_active || c.id === product?.category_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField>
          <SelectField label="Unit" {...register('unit_id')}><option value="">None</option>{lookups?.units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}</SelectField>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Price (USD)" inputMode="decimal" error={errors.usd?.message} {...register('usd')} />
          <Field label="Price (SOS)" inputMode="numeric" error={errors.sos?.message} {...register('sos')} />
          <Field label="Minimum stock" type="number" step="any" error={errors.min_stock?.message} {...register('min_stock')} />
        </div>
        <div>
          <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-ink-700"><ImageIcon className="h-4 w-4" />Product image (optional)</label>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onFile(e.target.files?.[0])} className="block w-full text-sm" />
          {fileError && <p className="mt-1.5 text-sm text-red-600">{fileError}</p>}
        </div>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" {...register('track_expiry')} />Track expiry dates</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" {...register('is_active')} />Active</label>
        </div>
        <div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save product</Button></div>
      </form>
    </Modal>
  );
}
