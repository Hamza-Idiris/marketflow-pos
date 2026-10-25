import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui';
import { EmptyState, ErrorState, Modal, PageHeader, Pagination, Table, TableSkeleton, Td, Th } from '@/components/kit';
import { formatDateTime } from '@/lib/format';

const PAGE = 25;
interface Row { id: string; action: string; entity_type: string; created_at: string; details: unknown; actor: { full_name: string } | null; store: { name: string } | null }

export function AuditLogsPage() {
  const { isSuperAdmin, activeStore } = useAuth();
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<Row | null>(null);
  const q = useQuery({ queryKey: ['audit', page, isSuperAdmin, activeStore?.supermarket_id], queryFn: async () => {
    let query = supabase.from('audit_logs').select('id, action, entity_type, created_at, details, actor:profiles!actor_id(full_name), store:supermarkets(name)', { count: 'exact' }).order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (!isSuperAdmin && activeStore) query = query.eq('supermarket_id', activeStore.supermarket_id);
    const { data, error, count } = await query; if (error) throw error; return { rows: data as unknown as Row[], total: count ?? 0 }; } });
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Audit log" subtitle={isSuperAdmin ? 'Sensitive actions across all supermarkets.' : 'Sensitive actions in this supermarket.'} />
      {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : q.data!.rows.length === 0 ? <EmptyState title="No activity recorded yet" /> : <>
        <Table><thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th>{isSuperAdmin && <Th>Supermarket</Th>}<Th right /></tr></thead>
          <tbody>{q.data!.rows.map((r) => <tr key={r.id}><Td>{formatDateTime(r.created_at)}</Td><Td>{r.actor?.full_name ?? 'System'}</Td><Td className="font-mono text-xs">{r.action}</Td>{isSuperAdmin && <Td>{r.store?.name ?? 'Platform'}</Td>}<Td right><Button variant="ghost" className="h-9" onClick={() => setDetail(r)}>Details</Button></Td></tr>)}</tbody></Table>
        <Pagination page={page} pageSize={PAGE} total={q.data!.total} onChange={setPage} /></>}
      {detail && <Modal title={detail.action} onClose={() => setDetail(null)} wide><pre className="max-h-96 overflow-auto rounded-lg bg-slate-50 p-3 text-xs">{JSON.stringify(detail.details, null, 2)}</pre></Modal>}
    </div>
  );
}
