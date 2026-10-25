import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Pencil, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAction } from '@/hooks/useAction';
import { useStoreId } from '@/hooks/useStore';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button, Field } from '@/components/ui';
import { Badge, EmptyState, ErrorState, Modal, PageHeader, Table, TableSkeleton, Td, TextArea, Th } from '@/components/kit';
import type { Supplier } from '@/types/database';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter the supplier name'), phone: z.string().trim().optional(),
  email: z.string().trim().email('Enter a valid email').or(z.literal('')), address: z.string().trim().optional(),
  notes: z.string().trim().optional(), is_active: z.boolean(),
});

export function useSuppliers(storeId: string) {
  return useQuery({
    queryKey: ['suppliers', storeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('suppliers').select('id, name, phone, email, address, notes, is_active').eq('supermarket_id', storeId).order('name');
      if (error) throw error;
      return data as Supplier[];
    },
  });
}

export function SuppliersPage() {
  const storeId = useStoreId();
  const { activeRole } = useAuth();
  const canEdit = activeRole === 'admin';
  const q = useSuppliers(storeId);
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Suppliers" subtitle="Who you buy from." actions={canEdit ? <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" />New supplier</Button> : undefined} />
      {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : q.data!.length === 0 ? <EmptyState title="No suppliers yet" /> : (
        <Table>
          <thead><tr><Th>Name</Th><Th>Phone</Th><Th>Email</Th><Th>Status</Th>{canEdit && <Th right>Edit</Th>}</tr></thead>
          <tbody>{q.data!.map((s) => (
            <tr key={s.id}><Td className="font-medium">{s.name}</Td><Td>{s.phone ?? '-'}</Td><Td>{s.email ?? '-'}</Td><Td><Badge tone={s.is_active ? 'green' : 'gray'}>{s.is_active ? 'Active' : 'Inactive'}</Badge></Td>
              {canEdit && <Td right><Button variant="ghost" className="h-9 px-2" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}><Pencil className="h-4 w-4" /></Button></Td>}</tr>
          ))}</tbody>
        </Table>
      )}
      {editing && <SupplierForm storeId={storeId} supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SupplierForm({ storeId, supplier, onClose }: { storeId: string; supplier: Supplier | null; onClose: () => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: supplier?.name ?? '', phone: supplier?.phone ?? '', email: supplier?.email ?? '', address: supplier?.address ?? '', notes: supplier?.notes ?? '', is_active: supplier?.is_active ?? true },
  });
  const save = useAction(async (v: z.infer<typeof schema>) => {
    const row = { supermarket_id: storeId, name: v.name, phone: v.phone || null, email: v.email || null, address: v.address || null, notes: v.notes || null, is_active: v.is_active };
    const { error } = supplier ? await supabase.from('suppliers').update(row).eq('id', supplier.id) : await supabase.from('suppliers').insert(row);
    if (error) throw error;
  }, { invalidate: ['suppliers'], success: 'Supplier saved', onDone: onClose });
  return (
    <Modal title={supplier ? 'Edit supplier' : 'New supplier'} onClose={onClose}>
      <form className="space-y-4" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label="Name" error={errors.name?.message} {...register('name')} />
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Phone" {...register('phone')} /><Field label="Email" type="email" error={errors.email?.message} {...register('email')} /></div>
        <Field label="Address" {...register('address')} />
        <TextArea label="Notes" {...register('notes')} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" {...register('is_active')} />Active</label>
        <div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save</Button></div>
      </form>
    </Modal>
  );
}
