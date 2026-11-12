import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useAction } from '@/hooks/useAction';
import { useStoreId } from '@/hooks/useStore';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button, Field } from '@/components/ui';
import { Badge, EmptyState, ErrorState, Modal, PageHeader, SelectField, Table, TableSkeleton, Td, Th } from '@/components/kit';
import { inviteMember, inviteMessage } from '@/services/people';
import type { Role } from '@/types/database';

interface Member { id: string; user_id: string; role: Role; is_active: boolean; cashier_max_discount_pct: number; profile: { full_name: string } | null }
interface Invitation { id: string; email: string; full_name: string | null; role: Role; max_discount: number; created_at: string }
const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', stock_staff: 'Stock staff', cashier: 'Cashier' };

const inviteSchema = z.object({
  full_name: z.string().trim().min(2, 'Enter the full name'),
  email: z.string().trim().email('Enter a valid email'),
  role: z.enum(['admin', 'stock_staff', 'cashier']),
  max_discount: z.coerce.number().min(0, 'Minimum 0').max(100, 'Maximum 100'),
});

export function EmployeesPage() {
  const storeId = useStoreId();
  const { profile, isSupportView } = useAuth();
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const q = useQuery({
    queryKey: ['members', storeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('supermarket_members').select('id, user_id, role, is_active, cashier_max_discount_pct, profile:profiles(full_name)').eq('supermarket_id', storeId).order('created_at');
      if (error) throw error;
      return (data as unknown as Member[]).map((m) => ({ ...m, cashier_max_discount_pct: Number(m.cashier_max_discount_pct) }));
    },
  });
  const invQ = useQuery({
    queryKey: ['invitations', storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invitations')
        .select('id, email, full_name, role, max_discount, created_at')
        .eq('supermarket_id', storeId)
        .eq('status', 'pending')
        .order('created_at');
      if (error) throw error;
      return (data as unknown as Invitation[]).map((i) => ({ ...i, max_discount: Number(i.max_discount) }));
    },
  });
  const setActive = useAction((m: Member) => rpc('set_member_active', { p_member: m.id, p_active: !m.is_active }), { invalidate: ['members'], success: 'Updated' });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Employees and roles" subtitle="Control who can work in this supermarket and how much discount cashiers may give."
        actions={!isSupportView ? <Button onClick={() => setInviting(true)}><UserPlus className="h-4 w-4" />Add employee</Button> : undefined} />
      {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : q.data!.length === 0 ? <EmptyState title="No employees yet" /> : (
        <Table>
          <thead><tr><Th>Name</Th><Th>Role</Th><Th right>Discount limit</Th><Th>Status</Th><Th right>Actions</Th></tr></thead>
          <tbody>
            {q.data!.map((m) => (
              <tr key={m.id}>
                <Td className="font-medium">{m.profile?.full_name || 'Unnamed'}</Td>
                <Td>{ROLE_LABEL[m.role]}</Td>
                <Td right>{m.role === 'cashier' ? `${m.cashier_max_discount_pct}%` : '-'}</Td>
                <Td><Badge tone={m.is_active ? 'green' : 'gray'}>{m.is_active ? 'Active' : 'Disabled'}</Badge></Td>
                <Td right>
                  {isSupportView ? (
                    <span className="text-xs text-ink-400">View only</span>
                  ) : m.user_id === profile?.id ? <span className="text-xs text-ink-500">You</span> : (
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" className="h-9" onClick={() => setEditing(m)}>Edit</Button>
                      <Button variant="secondary" className="h-9" loading={setActive.isPending && setActive.variables?.id === m.id} onClick={() => setActive.mutate(m)}>{m.is_active ? 'Disable' : 'Enable'}</Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {(invQ.data && invQ.data.length > 0) && (
        <div className="mt-8">
          <h2 className="mb-3 text-base font-semibold text-ink-900">Waiting to sign up</h2>
          <Table>
            <thead><tr><Th>Email</Th><Th>Name</Th><Th>Role</Th><Th>Invited</Th><Th right>Actions</Th></tr></thead>
            <tbody>
              {invQ.data.map((inv) => (
                <PendingInvitationRow key={inv.id} inv={inv} storeId={storeId} />
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {inviting && <Invite storeId={storeId} onClose={() => setInviting(false)} />}
      {editing && <Edit storeId={storeId} member={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PendingInvitationRow({ inv, storeId }: { inv: Invitation; storeId: string }) {
  const { isSupportView } = useAuth();
  const qc = useQueryClient();
  const cancel = useAction(
    () => rpc('cancel_invitation', { p_id: inv.id }),
    {
      onDone: () => {
        toast.success('Invitation cancelled.');
        void qc.invalidateQueries({ queryKey: ['invitations', storeId] });
      },
    },
  );
  return (
    <tr>
      <Td>{inv.email}</Td>
      <Td>{inv.full_name ?? '-'}</Td>
      <Td>{ROLE_LABEL[inv.role]}{inv.role === 'cashier' ? ` (${inv.max_discount}% max disc.)` : ''}</Td>
      <Td>{new Date(inv.created_at).toLocaleDateString()}</Td>
      <Td right>
        {!isSupportView && <Button variant="secondary" className="h-9" loading={cancel.isPending} onClick={() => cancel.mutate(undefined)}>Cancel</Button>}
      </Td>
    </tr>
  );
}

function Invite({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, watch, formState: { errors } } = useForm<z.input<typeof inviteSchema>, unknown, z.infer<typeof inviteSchema>>({ resolver: zodResolver(inviteSchema), defaultValues: { full_name: '', email: '', role: 'cashier', max_discount: 0 } });
  const invite = useAction(
    (v: z.infer<typeof inviteSchema>) => inviteMember({ store: storeId, ...v }),
    {
      invalidate: ['members'],
      onDone: (result) => {
        toast.success(inviteMessage(result), { duration: 6000 });
        void qc.invalidateQueries({ queryKey: ['invitations', storeId] });
        onClose();
      },
    },
  );
  return (
    <Modal title="Add employee" onClose={onClose}>
      <form className="space-y-4" onSubmit={handleSubmit((v) => invite.mutate(v))} noValidate>
        <Field label="Full name" error={errors.full_name?.message} {...register('full_name')} />
        <Field label="Email" type="email" error={errors.email?.message} {...register('email')} />
        <SelectField label="Role" {...register('role')}><option value="cashier">Cashier</option><option value="stock_staff">Stock staff</option><option value="admin">Admin</option></SelectField>
        {watch('role') === 'cashier' && <Field label="Maximum discount (%)" type="number" step="0.5" error={errors.max_discount?.message} {...register('max_discount')} />}
        <p className="text-sm text-ink-500">
          If this person already has a confirmed account they are added immediately. Otherwise ask them to go to <strong>Create account</strong> and sign up with this exact email address.
        </p>
        <div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit" loading={invite.isPending}>Add</Button></div>
      </form>
    </Modal>
  );
}

function Edit({ storeId, member, onClose }: { storeId: string; member: Member; onClose: () => void }) {
  const [role, setRole] = useState<Role>(member.role);
  const [discount, setDiscount] = useState(String(member.cashier_max_discount_pct));
  const save = useAction(() => rpc('upsert_store_member', { p_store: storeId, p_user: member.user_id, p_role: role, p_max_discount: role === 'cashier' ? Number(discount) : 0 }),
    { invalidate: ['members'], success: 'Saved', onDone: onClose });
  const bad = role === 'cashier' && (discount === '' || Number(discount) < 0 || Number(discount) > 100);
  return (
    <Modal title={`Edit ${member.profile?.full_name ?? 'employee'}`} onClose={onClose}>
      <div className="space-y-4">
        <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="cashier">Cashier</option><option value="stock_staff">Stock staff</option><option value="admin">Admin</option></SelectField>
        {role === 'cashier' && <Field label="Maximum discount (%)" type="number" step="0.5" value={discount} onChange={(e) => setDiscount(e.target.value)} error={bad ? 'Enter a value from 0 to 100' : undefined} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={bad} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></div>
      </div>
    </Modal>
  );
}
