import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { KeyRound, Plus, ShieldCheck, UserPlus, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useAction } from '@/hooks/useAction';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button, Field } from '@/components/ui';
import { Badge, ConfirmDialog, EmptyState, ErrorState, Modal, PageHeader, Table, TableSkeleton, Td, TextArea, Th } from '@/components/kit';
import { inviteMember, inviteMessage } from '@/services/people';
import { formatDateTime } from '@/lib/format';
import type { AccessGrant } from '@/types/database';

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
const requestSchema = z.object({
  reason: z.string().trim().min(5, 'Reason must be at least 5 characters'),
});

export function SupermarketsPage() {
  const { session, refetchGrants } = useAuth();
  const [creating, setCreating] = useState(false);
  const [addingAdminFor, setAddingAdminFor] = useState<Store | null>(null);
  const [requestingFor, setRequestingFor] = useState<Store | null>(null);
  const [toggle, setToggle] = useState<Store | null>(null);

  const q = useQuery({
    queryKey: ['supermarkets'],
    queryFn: async () => {
      const { data, error } = await supabase.from('supermarkets').select('id, name, slug, phone, address, is_active').order('name');
      if (error) throw error;
      return data as Store[];
    },
  });

  const grantsQuery = useQuery({
    queryKey: ['my-access-grants', session?.user.id],
    queryFn: async () => {
      if (!session?.user.id) return [];
      const { data, error } = await supabase
        .from('access_grants')
        .select('*')
        .eq('requested_by', session.user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as AccessGrant[];
    },
  });

  const setActive = useAction((s: Store) => rpc('set_supermarket_active', { p_id: s.id, p_active: !s.is_active }), {
    invalidate: ['supermarkets'], success: 'Status updated', onDone: () => setToggle(null),
  });

  const revoke = useAction(
    (grantId: string) => rpc('revoke_access', { p_id: grantId }),
    {
      invalidate: ['my-access-grants'],
      success: 'Support access ended',
      onDone: () => void refetchGrants(),
    },
  );

  const grantsByStore = new Map<string, AccessGrant>();
  for (const g of grantsQuery.data ?? []) {
    // Keep newest grant per store
    if (!grantsByStore.has(g.supermarket_id)) {
      grantsByStore.set(g.supermarket_id, g);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Supermarkets" subtitle="Create stores, assign administrators and suspend access." actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New supermarket</Button>} />
      {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : q.data!.length === 0 ? (
        <EmptyState title="No supermarkets yet" hint="Create the first one, then invite its administrator." />
      ) : (
        <Table>
          <thead><tr><Th>Name</Th><Th>Phone</Th><Th>Status</Th><Th>Support access</Th><Th right>Actions</Th></tr></thead>
          <tbody>
            {q.data!.map((s) => {
              const latestGrant = grantsByStore.get(s.id);
              const isApproved = latestGrant?.status === 'approved' && latestGrant.expires_at && new Date(latestGrant.expires_at) > new Date();
              const isPending = latestGrant?.status === 'pending';

              return (
                <tr key={s.id}>
                  <Td><div className="font-medium">{s.name}</div><div className="text-xs text-ink-500">{s.address ?? s.slug}</div></Td>
                  <Td>{s.phone ?? '-'}</Td>
                  <Td><Badge tone={s.is_active ? 'green' : 'red'}>{s.is_active ? 'Active' : 'Suspended'}</Badge></Td>
                  <Td>
                    {isApproved ? (
                      <div>
                        <Badge tone="green"><ShieldCheck className="mr-1 h-3 w-3 inline" />Active</Badge>
                        <div className="text-[11px] text-ink-500 mt-0.5">Expires {formatDateTime(latestGrant.expires_at!)}</div>
                      </div>
                    ) : isPending ? (
                      <Badge tone="amber">Pending approval</Badge>
                    ) : latestGrant?.status === 'denied' ? (
                      <Badge tone="red">Denied</Badge>
                    ) : latestGrant?.status === 'revoked' ? (
                      <Badge tone="gray">Revoked</Badge>
                    ) : (
                      <span className="text-xs text-ink-400">None</span>
                    )}
                  </Td>
                  <Td right>
                    <div className="flex justify-end gap-2">
                      {isApproved ? (
                        <Button
                          variant="secondary"
                          className="h-9 text-red-600 hover:text-red-700"
                          loading={revoke.isPending && revoke.variables === latestGrant.id}
                          onClick={() => revoke.mutate(latestGrant.id)}
                        >
                          <XCircle className="h-4 w-4" />End access
                        </Button>
                      ) : !isPending ? (
                        <Button variant="secondary" className="h-9" onClick={() => setRequestingFor(s)}>
                          <KeyRound className="h-4 w-4" />Request access
                        </Button>
                      ) : null}
                      <Button variant="secondary" className="h-9" onClick={() => setAddingAdminFor(s)}><UserPlus className="h-4 w-4" />Admin</Button>
                      <Button variant="secondary" className="h-9" onClick={() => setToggle(s)}>{s.is_active ? 'Suspend' : 'Activate'}</Button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {creating && <CreateStore onClose={() => setCreating(false)} />}
      {addingAdminFor && <AddAdmin store={addingAdminFor} onClose={() => setAddingAdminFor(null)} />}
      {requestingFor && <RequestAccessModal store={requestingFor} onClose={() => setRequestingFor(null)} onRequested={() => { void grantsQuery.refetch(); void refetchGrants(); }} />}
      {toggle && (
        <ConfirmDialog title={toggle.is_active ? 'Suspend supermarket?' : 'Activate supermarket?'} danger={toggle.is_active} loading={setActive.isPending}
          message={toggle.is_active ? `${toggle.name} staff will immediately lose access until it is activated again.` : `${toggle.name} staff will be able to sign in and work again.`}
          confirmLabel={toggle.is_active ? 'Suspend' : 'Activate'} onConfirm={() => setActive.mutate(toggle)} onClose={() => setToggle(null)} />
      )}
    </div>
  );
}

function RequestAccessModal({ store, onClose, onRequested }: { store: Store; onClose: () => void; onRequested: () => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof requestSchema>>({ resolver: zodResolver(requestSchema) });
  const req = useAction(
    (v: z.infer<typeof requestSchema>) => rpc('request_access', { p_store: store.id, p_reason: v.reason }),
    {
      success: 'Access requested. Awaiting supermarket admin approval.',
      onDone: () => {
        onRequested();
        onClose();
      },
    },
  );

  return (
    <Modal title={`Request support access to ${store.name}`} onClose={onClose}>
      <form className="space-y-4" onSubmit={handleSubmit((v) => req.mutate(v))} noValidate>
        <p className="text-sm text-ink-600">
          Super admins do not have access to store detail data by default. Explain why you need temporary read-only access.
          An administrator of <strong>{store.name}</strong> will review and decide your request.
        </p>
        <TextArea
          label="Reason for access request (min 5 characters)"
          rows={3}
          error={errors.reason?.message}
          placeholder="e.g. Investigating receipt print discrepancy reported by store staff..."
          {...register('reason')}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={req.isPending}>Send request</Button>
        </div>
      </form>
    </Modal>
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
  const invite = useAction(
    (v: z.infer<typeof adminSchema>) => inviteMember({ store: store.id, role: 'admin', ...v }),
    {
      onDone: (result) => {
        toast.success(inviteMessage(result), { duration: 6000 });
        onClose();
      },
    },
  );
  return (
    <Modal title={`Add administrator to ${store.name}`} onClose={onClose}>
      <form className="space-y-4" onSubmit={handleSubmit((v) => invite.mutate(v))} noValidate>
        <Field label="Full name" error={errors.full_name?.message} {...register('full_name')} />
        <Field label="Email" type="email" error={errors.email?.message} {...register('email')} />
        <p className="text-sm text-ink-500">
          If this person already has a confirmed account they are added immediately. Otherwise an invitation is saved —
          ask them to go to <strong>Create account</strong> and sign up with this exact email address.
        </p>
        <div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit" loading={invite.isPending}>Send invitation</Button></div>
      </form>
    </Modal>
  );
}
