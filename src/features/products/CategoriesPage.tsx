import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAction } from '@/hooks/useAction';
import { useStoreId } from '@/hooks/useStore';
import { Button, Card, Field } from '@/components/ui';
import { Badge, EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/kit';
import { useCatalogLookups } from './ProductsPage';

export function CategoriesPage() {
  const storeId = useStoreId();
  const q = useCatalogLookups(storeId);
  const [cat, setCat] = useState('');
  const [unitName, setUnitName] = useState('');
  const [unitAbbr, setUnitAbbr] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const done = { invalidate: ['lookups'] };
  const addCat = useAction(async () => { const { error } = await supabase.from('categories').insert({ supermarket_id: storeId, name: cat.trim() }); if (error) throw error; }, { ...done, success: 'Category added', onDone: () => setCat('') });
  const renameCat = useAction(async () => { const { error } = await supabase.from('categories').update({ name: renaming!.name.trim() }).eq('id', renaming!.id); if (error) throw error; }, { ...done, success: 'Category renamed', onDone: () => setRenaming(null) });
  const toggleCat = useAction(async (c: { id: string; is_active: boolean }) => { const { error } = await supabase.from('categories').update({ is_active: !c.is_active }).eq('id', c.id); if (error) throw error; }, { ...done, success: 'Updated' });
  const addUnit = useAction(async () => { const { error } = await supabase.from('units').insert({ supermarket_id: storeId, name: unitName.trim(), abbreviation: unitAbbr.trim() }); if (error) throw error; }, { ...done, success: 'Unit added', onDone: () => { setUnitName(''); setUnitAbbr(''); } });

  if (q.isLoading) return <TableSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  return (
    <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-2">
      <div className="lg:col-span-2"><PageHeader title="Categories and units" subtitle="Keep the catalog organised." /></div>
      <Card className="space-y-4">
        <h2 className="font-semibold">Categories</h2>
        <div className="flex items-end gap-2"><div className="flex-1"><Field label="New category" value={cat} onChange={(e) => setCat(e.target.value)} /></div><Button disabled={!cat.trim()} loading={addCat.isPending} onClick={() => addCat.mutate(undefined)}>Add</Button></div>
        {q.data!.categories.length === 0 ? <EmptyState title="No categories yet" /> : (
          <ul className="divide-y divide-slate-100">
            {q.data!.categories.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2.5">
                {renaming?.id === c.id ? <input aria-label="Category name" autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: c.id, name: e.target.value })} className="h-10 flex-1 rounded-lg border border-ink-300 px-3 text-sm" /> : <span className="font-medium">{c.name} {!c.is_active && <Badge>Archived</Badge>}</span>}
                <div className="flex gap-1">
                  {renaming?.id === c.id ? <><Button className="h-9" disabled={!renaming.name.trim()} loading={renameCat.isPending} onClick={() => renameCat.mutate(undefined)}>Save</Button><Button variant="secondary" className="h-9" onClick={() => setRenaming(null)}>Cancel</Button></>
                    : <><Button variant="ghost" className="h-9" onClick={() => setRenaming({ id: c.id, name: c.name })}>Rename</Button><Button variant="ghost" className="h-9" onClick={() => toggleCat.mutate(c)}>{c.is_active ? 'Archive' : 'Restore'}</Button></>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="space-y-4">
        <h2 className="font-semibold">Units of measurement</h2>
        <div className="grid grid-cols-[1fr_6rem_auto] items-end gap-2"><Field label="Name" value={unitName} onChange={(e) => setUnitName(e.target.value)} /><Field label="Short" value={unitAbbr} onChange={(e) => setUnitAbbr(e.target.value)} /><Button disabled={!unitName.trim() || !unitAbbr.trim()} loading={addUnit.isPending} onClick={() => addUnit.mutate(undefined)}>Add</Button></div>
        {q.data!.units.length === 0 ? <EmptyState title="No units yet" hint="For example: Piece (pc), Kilogram (kg), Litre (L)." /> : (
          <ul className="divide-y divide-slate-100">{q.data!.units.map((u) => <li key={u.id} className="flex justify-between py-2.5"><span className="font-medium">{u.name}</span><span className="text-ink-500">{u.abbreviation}</span></li>)}</ul>
        )}
      </Card>
    </div>
  );
}
