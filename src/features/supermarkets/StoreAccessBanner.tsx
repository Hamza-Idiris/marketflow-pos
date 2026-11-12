import { useQuery } from '@tanstack/react-query';
import { Check, Clock, ShieldAlert, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useAction } from '@/hooks/useAction';
import { Button } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import type { AccessGrant } from '@/types/database';

interface StoreAccessBannerProps {
  storeId: string;
}

export function StoreAccessBanner({ storeId }: StoreAccessBannerProps) {
  const q = useQuery({
    queryKey: ['store-access-grants', storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('access_grants')
        .select('id, supermarket_id, requested_by, reason, status, decided_by, decided_at, expires_at, created_at, requester:profiles!access_grants_requested_by_fkey(id, full_name)')
        .eq('supermarket_id', storeId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as AccessGrant[];
    },
  });

  const decide = useAction(
    (args: { id: string; approve: boolean; hours?: number }) =>
      rpc('decide_access', { p_id: args.id, p_approve: args.approve, p_hours: args.hours ?? 24 }),
    {
      invalidate: ['store-access-grants'],
      success: 'Access decision saved',
    },
  );

  const revoke = useAction(
    (id: string) => rpc('revoke_access', { p_id: id }),
    {
      invalidate: ['store-access-grants'],
      success: 'Support access revoked',
    },
  );

  const grants = q.data ?? [];
  const pending = grants.filter((g) => g.status === 'pending');
  const active = grants.filter((g) => g.status === 'approved' && g.expires_at && new Date(g.expires_at) > new Date());

  if (pending.length === 0 && active.length === 0) return null;

  return (
    <div className="space-y-3">
      {pending.map((req) => (
        <div
          key={req.id}
          className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-ink-900 shadow-sm"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-amber-600" />
                <span className="font-semibold text-amber-950">
                  Support access requested by {req.requester?.full_name ?? 'Super admin'}
                </span>
                <span className="text-xs text-amber-800">
                  ({formatDateTime(req.created_at)})
                </span>
              </div>
              <p className="text-sm text-ink-700 bg-white/70 rounded-lg p-2.5 border border-amber-200">
                <strong className="text-ink-900">Reason:</strong> &ldquo;{req.reason}&rdquo;
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 sm:self-center">
              <span className="text-xs font-medium text-ink-600 mr-1">Approve for:</span>
              {[1, 4, 24, 72].map((hours) => (
                <Button
                  key={hours}
                  variant="secondary"
                  className="h-8 px-2.5 text-xs bg-white text-green-700 hover:bg-green-50 hover:text-green-800 border-green-300"
                  loading={decide.isPending && decide.variables?.id === req.id && decide.variables?.hours === hours}
                  onClick={() => decide.mutate({ id: req.id, approve: true, hours })}
                >
                  <Check className="h-3 w-3 mr-1" />
                  {hours}h
                </Button>
              ))}
              <Button
                variant="secondary"
                className="h-8 px-2.5 text-xs bg-white text-red-600 hover:bg-red-50 hover:text-red-700 border-red-300"
                loading={decide.isPending && decide.variables?.id === req.id && !decide.variables?.approve}
                onClick={() => decide.mutate({ id: req.id, approve: false })}
              >
                <X className="h-3 w-3 mr-1" />
                Deny
              </Button>
            </div>
          </div>
        </div>
      ))}

      {active.map((g) => (
        <div
          key={g.id}
          className="flex flex-col gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950 sm:flex-row sm:items-center sm:justify-between shadow-sm"
        >
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-blue-600 shrink-0" />
            <span>
              <strong>Active support view:</strong> {g.requester?.full_name ?? 'Super admin'} has read-only access until{' '}
              <span className="font-semibold">{formatDateTime(g.expires_at!)}</span>.
            </span>
          </div>
          <Button
            variant="secondary"
            className="h-8 px-3 text-xs bg-white text-red-600 hover:bg-red-50 hover:text-red-700 border-red-300 self-end sm:self-auto shrink-0"
            loading={revoke.isPending && revoke.variables === g.id}
            onClick={() => revoke.mutate(g.id)}
          >
            Revoke
          </Button>
        </div>
      ))}
    </div>
  );
}

