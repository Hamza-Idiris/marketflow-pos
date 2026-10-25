import { useAuth } from '@/features/auth/AuthProvider';

/** The active supermarket id; pages that need a store are only reachable when one exists. */
export function useStoreId(): string {
  const { activeStore } = useAuth();
  if (!activeStore) throw new Error('No active supermarket');
  return activeStore.supermarket_id;
}
