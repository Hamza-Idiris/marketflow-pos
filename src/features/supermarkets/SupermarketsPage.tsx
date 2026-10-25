import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, UserPlus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useAction } from '@/hooks/useAction';
import { Button, Field } from '@/components/ui';
import { Badge, ConfirmDialog, EmptyState, ErrorState, Modal, PageHeader, Table, TableSkeleton, Td, Th } from '@/components/kit';
import { inviteUser } from '@/services/people';

interface Store { id: string; name: string; slug: string; phone: string | null; address: string | null; is_active: boolean }

const schema = z.object({
  name: z.string().trim().min(2, 'Enter the supermarket name'),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes'),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
});
const adminSchema = z.object({
  full_name: z.string().trim().min(2, 'Enter the full name'),
  email: z.string().trim().email('Enter a valid email'),
});

export function SupermarketsPage() {
  const [creating, setCreating] = useState(false);
  const [addingAdminFor, setAddingAdminFor] = useState<Store | null>(null);
  const [toggle, setToggle] = useState<Store | null>(null);
  const q = useQuery({
    queryKey: ['supermarkets'],
    queryFn: async () => {
      const { data, error } = await supabase.from('supermarkets').select('id, name, slug, phone, address, is_active').order('name');
      if (error) throw error;
      return data as Store[];
    },
  });
  const setActive = useAction((s: Store) => rpc('set_supermarket_active', { p_id: s.id, p_active: !s.is_active }), {
    invalidate: ['supermarkets'], success: 'Status updated', onDone: () => setToggle(null),
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Supermarkets" subtitle="Create stores, assign administrators and suspend access." actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New supermarket</Button>} />
      {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : q.data!.length === 0 ? (
        <EmptyState title="No supermarkets yet" hint="Create the first one, then invite its administrator." />
      ) : (
        <Table>
          <thead><tr><Th>Name</Th><Th>Phone</Th><Th>Status</Th><Th right>Actions</Th></tr></thead>
          <tbody>
            {q.data!.map((s) => (
              <tr key={s.id}>
                <Td><div className="font-medium">{s.name}</div><div className="text-xs text-ink-500">{s.address ?? s.slug}</div></Td>
                <Td>{s.phone ?? '-'}</Td>
                <Td><Badge tone={s.is_active ? 'green' : 'red'}>{s.is_active ? 'Active' : 'Suspended'}</Badge></Td>
                <Td right>
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" className="h-9" onClick={() => setAddingAdminFor(s)}><UserPlus className="h-4 w-4" />Admin</Button>
                    <Button variant="secondary" className="h-9" onClick={() => setToggle(s)}>{s.is_active ? 'Suspend' : 'Activate'}</Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {creating && <CreateStore onClose={() => setCreating(false)} />}
      {addingAdminFor && <AddAdmin store={addingAdminFor} onClose={() => setAddingAdminFor(null)} />}
      {toggle && (
        <ConfirmDialog title={toggle.is_active ? 'Suspend supermarket?' : 'Activate supermarket?'} danger={toggle.is_active} loading={setActive.isPending}
          message={toggle.is_active ? `${toggle.name} staff will immediately lose access until it is activated again.` : `${toggle.name} staff will be able to sign in and work again.`}
          confirmLabel={toggle.is_active ? 'Suspend' : 'Activate'} onConfirm={() => setActive.mutate(toggle)} onClose={() => setToggle(null)} />
      )}
    </div>
  );
}

function CreateStore({ onClose }: { onClose: () => void }) {
  const { register, handleSubmit, setValue, formState: { errors } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const create = useAction((v: z.infer<typeof schema>) => rpc('create_supermarket', { p_name: v.name, p_slug: v.slug, p_phone: v.phone || null, p_address: v.address || null }),
    { invalidate: ['supermarkets'], success: 'Supermarket created', onDone: onClose });
  return (
    <Modal title="New supermarket" onClose={onClose}>
      <form className="space-y-4" onSubmit={handleSubmit((v) => create.mutate(v))} noValidate>
        <Field label="Name" error={errors.name?.message} {...register('name', { onChange: (e) => setValue('slug', String(e.target.value).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) })} />
        <Field label="Short code (used internally)" error={errors.slug?.message} {...register('slug')} />
        <Field label="Phone" {...register('phone')} />
        <Field label="Address" {...register('address')} />
        <div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit" loading={create.isPending}>Create</Button></div>
      </form>
    </Modal>
  );
}

function AddAdmin({ store, onClose }: { store: Store; onClose: () => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof adminSchema>>({ resolver: zodResolver(adminSchema) });
  const invite = useAction((v: z.infer<typeof adminSchema>) => inviteUser({ store: store.id, role: 'admin', ...v }), { success: 'Invitation sent', onDone: onClose });
  return (
    <Modal title={`Add administrator to ${store.name}`} onClose={onClose}>
      <form className="space-y-4" onSubmit={handleSubmit((v) => invite.mutate(v))} noValidate>
        <Field label="Full name" error={errors.full_name?.message} {...register('full_name')} />
        <Field label="Email" type="email" error={errors.email?.message} {...register('email')} />
        <p className="text-sm text-ink-500">They receive an email to set their password. If the person already has an account they are simply added.</p>
        <div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit" loading={invite.isPending}>Send invitation</Button></div>
      </form>
    </Modal>
  );
}
