import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { dbMessage } from '@/lib/rpc';

/** Mutation with consistent success/error toasts and cache invalidation. */
export function useAction<A, R = unknown>(
  fn: (args: A) => Promise<R>,
  opts: { invalidate?: string[]; success?: string; onDone?: (result: R) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      if (opts.success) toast.success(opts.success);
      opts.invalidate?.forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
      opts.onDone?.(result);
    },
    onError: (e) => toast.error(dbMessage(e)),
  });
}
