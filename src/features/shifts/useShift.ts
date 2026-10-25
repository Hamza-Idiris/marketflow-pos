import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';

export interface Shift { id: string; status: 'open' | 'closed'; opened_at: string; closed_at: string | null; opening_usd: number; opening_sos: number; closing_usd: number | null; closing_sos: number | null; difference_usd: number | null; difference_sos: number | null; cashier_id: string; notes: string | null }

/** The signed-in cashier's open shift in the active store, if any. */
export function useOpenShift(storeId: string) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ['open-shift', storeId, profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('cashier_shifts').select('id, status, opened_at, closed_at, opening_usd, opening_sos, closing_usd, closing_sos, difference_usd, difference_sos, cashier_id, notes')
        .eq('supermarket_id', storeId).eq('cashier_id', profile!.id).eq('status', 'open').maybeSingle();
      if (error) throw error;
      return data as Shift | null;
    },
  });
}
