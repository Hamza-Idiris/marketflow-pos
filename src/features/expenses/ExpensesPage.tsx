import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAction } from '@/hooks/useAction';
import { useStoreId } from '@/hooks/useStore';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button, Field } from '@/components/ui';
import { Badge, ConfirmDialog, EmptyState, ErrorState, Modal, PageHeader, Pagination, SelectField, Table, TableSkeleton, Td, Th } from '@/components/kit';
import { addDaysISO, formatDate, formatMoney, todayISO } from '@/lib/format';
import type { Currency } from '@/types/database';

const PAGE = 20;
interface Row { id: string; category: string; description: string; amount: number; currency: Currency; expense_date: string; status: 'recorded' | 'cancelled'; creator: { full_name: string } | null }
const schema = z.object({ category: z.string().trim().min(1, 'Enter a category'), description: z.string().trim().min(1, 'Describe the expense'),
  amount: z.coerce.number().positive('Enter an amount above zero'), currency: z.enum(['USD', 'SOS']), expense_date: z.string().min(1, 'Pick a date') });

export function ExpensesPage() {
  const storeId = useStoreId();
  const { profile } = useAuth();
  const [page, setPage] = useState(0);
  const [from, setFrom] = useState(addDaysISO(todayISO(), -30));
  const [to, setTo] = useState(todayISO());
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<Row | null>(null);
  const q = useQuery({ queryKey: ['expenses', storeId, page, from, to], queryFn: async () => {
    const { data, error, count } = await supabase.from('expenses').select('id, category, description, amount, currency, expense_date, status, creator:profiles!created_by(full_name)', { count: 'exact' })
      .eq('supermarket_id', storeId).gte('expense_date', from).lte('expense_date', to).order('expense_date', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error; return { rows: data as unknown as Row[], total: count ?? 0 }; } });
  const cancel = useAction(async (r: Row) => { const { error } = await supabase.from('expenses').update({ status: 'cancelled' }).eq('id', r.id); if (error) throw error; }, { invalidate: ['expenses', 'report'], success: 'Expense cancelled', onDone: () => setCancelling(null) });
  const sums = (q.data?.rows ?? []).filter((r) => r.status === 'recorded').reduce<Record<string, number>>((a, r) => ({ ...a, [r.currency]: (a[r.currency] ?? 0) + Number(r.amount) }), {});
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Expenses" subtitle="Operating costs such as rent, electricity and wages." actions={<Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Record expense</Button>} />
      <div className="mb-4 grid max-w-md grid-cols-2 gap-3"><Field label="From" type="date" max={to} value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} /><Field label="To" type="date" min={from} value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} /></div>
      {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : q.data!.rows.length === 0 ? <EmptyState title="No expenses in this period" /> : <>
        <p className="mb-2 text-sm text-ink-500">On this page: {Object.entries(sums).map(([c, v]) => formatMoney(v, c as Currency)).join(' and ') || 'nothing recorded'}</p>
        <Table><thead><tr><Th>Date</Th><Th>Category</Th><Th>Description</Th><Th>By</Th><Th right>Amount</Th><Th>Status</Th><Th right /></tr></thead>
          <tbody>{q.data!.rows.map((r) => <tr key={r.id} className={r.status === 'cancelled' ? 'opacity-50' : ''}><Td>{formatDate(r.expense_date)}</Td><Td>{r.category}</Td><Td>{r.description}</Td><Td>{r.creator?.full_name}</Td><Td right>{formatMoney(r.amount, r.currency)}</Td>
            <Td><Badge tone={r.status === 'recorded' ? 'green' : 'gray'}>{r.status}</Badge></Td><Td right>{r.status === 'recorded' && <Button variant="ghost" className="h-9" onClick={() => setCancelling(r)}>Cancel</Button>}</Td></tr>)}</tbody></Table>
        <Pagination page={page} pageSize={PAGE} total={q.data!.total} onChange={setPage} /></>}
      {adding && <Add storeId={storeId} userId={profile!.id} onClose={() => setAdding(false)} />}
      {cancelling && <ConfirmDialog title="Cancel this expense?" message="It will no longer count in profit reports. The record is kept." confirmLabel="Cancel expense" danger loading={cancel.isPending} onConfirm={() => cancel.mutate(cancelling)} onClose={() => setCancelling(null)} />}
    </div>
  );
}

function Add({ storeId, userId, onClose }: { storeId: string; userId: string; onClose: () => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm<z.input<typeof schema>, unknown, z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { category: '', description: '', amount: 0, currency: 'USD', expense_date: todayISO() } });
  const save = useAction(async (v: z.infer<typeof schema>) => { const { error } = await supabase.from('expenses').insert({ supermarket_id: storeId, created_by: userId, ...v }); if (error) throw error; }, { invalidate: ['expenses', 'report'], success: 'Expense recorded', onDone: onClose });
  return (
    <Modal title="Record expense" onClose={onClose}>
      <form className="space-y-4" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label="Category" placeholder="Rent, Electricity, Wages..." error={errors.category?.message} {...register('category')} />
        <Field label="Description" error={errors.description?.message} {...register('description')} />
        <div className="grid grid-cols-[1fr_6rem] gap-3"><Field label="Amount" type="number" step="any" min={0} error={errors.amount?.message} {...register('amount')} /><SelectField label="Currency" {...register('currency')}><option>USD</option><option>SOS</option></SelectField></div>
        <Field label="Date" type="date" max={todayISO()} error={errors.expense_date?.message} {...register('expense_date')} />
        <div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save</Button></div>
      </form>
    </Modal>
  );
}
