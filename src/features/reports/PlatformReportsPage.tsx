import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { rpc } from '@/lib/rpc';
import { Button } from '@/components/ui';
import { Badge, EmptyState, ErrorState, PageHeader, Table, TableSkeleton, Td, Th } from '@/components/kit';
import { downloadCsv } from '@/lib/csv';
import { formatMoney } from '@/lib/format';
import type { Currency } from '@/types/database';

export interface PlatformRow { store_id: string; store_name: string; is_active: boolean; currency: Currency | null; sales_count: number; total: number }
export function usePlatform() {
  return useQuery({ queryKey: ['platform-summary'], queryFn: async () => (await rpc<PlatformRow[]>('platform_summary')).map((r) => ({ ...r, total: Number(r.total), sales_count: Number(r.sales_count) })) });
}

export function PlatformReportsPage() {
  const q = usePlatform();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Platform reports" subtitle="Sales per supermarket over the last 30 days. Each currency is shown on its own row."
        actions={<Button variant="secondary" disabled={!q.data?.length} onClick={() => downloadCsv('platform-last-30-days.csv', q.data!.map((r) => ({ Supermarket: r.store_name, Status: r.is_active ? 'Active' : 'Suspended', Currency: r.currency ?? '', Sales: r.sales_count, Total: r.total })))}><Download className="h-4 w-4" />CSV</Button>} />
      {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : q.data!.length === 0 ? <EmptyState title="No supermarkets yet" /> : (
        <Table><thead><tr><Th>Supermarket</Th><Th>Status</Th><Th>Currency</Th><Th right>Sales</Th><Th right>Total</Th></tr></thead>
          <tbody>{q.data!.map((r, i) => <tr key={i}><Td className="font-medium">{r.store_name}</Td><Td><Badge tone={r.is_active ? 'green' : 'red'}>{r.is_active ? 'Active' : 'Suspended'}</Badge></Td><Td>{r.currency ?? '-'}</Td><Td right>{r.sales_count}</Td><Td right>{r.currency ? formatMoney(r.total, r.currency) : '-'}</Td></tr>)}</tbody></Table>)}
    </div>
  );
}
