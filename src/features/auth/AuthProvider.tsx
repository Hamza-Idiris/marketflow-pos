import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Membership, Profile, Role } from '@/types/database';

const STORE_KEY = 'pos.activeStore';

interface AuthContextValue {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  memberships: Membership[];
  isSuperAdmin: boolean;
  activeStore: Membership | null;
  activeRole: Role | null;
  blockedMessage: string | null;
  selectStore: (storeId: string) => void;
  signOut: () => Promise<void>;
  clearBlockedMessage: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadContext(userId: string) {
  const [{ data: profile, error: pErr }, { data: members, error: mErr }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, phone, is_super_admin, is_active').eq('id', userId).maybeSingle(),
    supabase
      .from('supermarket_members')
      .select('id, supermarket_id, role, cashier_max_discount_pct, supermarket:supermarkets(id, name, is_active)')
      .eq('user_id', userId)
      .eq('is_active', true),
  ]);
  if (pErr) throw pErr;
  if (mErr) throw mErr;
  const memberships = ((members ?? []) as unknown as Array<Omit<Membership, 'supermarket'> & { supermarket: Membership['supermarket'] | null }>)
    // RLS hides suspended stores from staff, so a missing store means no access.
    .filter((m): m is Membership => m.supermarket !== null && m.supermarket.is_active)
    .map((m) => ({ ...m, cashier_max_discount_pct: Number(m.cashier_max_discount_pct) }));
  return { profile: (profile as Profile | null) ?? null, memberships };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeStoreId, setActiveStoreId] = useState<string | null>(() => localStorage.getItem(STORE_KEY));
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  const reset = useCallback(() => {
    setProfile(null);
    setMemberships([]);
  }, []);

  const hydrate = useCallback(
    async (s: Session | null) => {
      setSession(s);
      if (!s) {
        reset();
        setLoading(false);
        return;
      }
      try {
        const ctx = await loadContext(s.user.id);
        if (!ctx.profile || !ctx.profile.is_active) {
          setBlockedMessage('This account is disabled. Contact your administrator.');
          await supabase.auth.signOut();
          reset();
        } else {
          setProfile(ctx.profile);
          setMemberships(ctx.memberships);
        }
      } catch {
        setBlockedMessage('We could not load your account. Check your connection and sign in again.');
        await supabase.auth.signOut();
        reset();
      } finally {
        setLoading(false);
      }
    },
    [reset],
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => void hydrate(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'TOKEN_REFRESHED') return setSession(s);
      // Defer so we never call Supabase inside the auth callback itself.
      setTimeout(() => void hydrate(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [hydrate]);

  // Persist the selected store only after confirming membership in it.
  const activeStore = useMemo(
    () => memberships.find((m) => m.supermarket_id === activeStoreId) ?? memberships[0] ?? null,
    [memberships, activeStoreId],
  );
  useEffect(() => {
    if (activeStore) localStorage.setItem(STORE_KEY, activeStore.supermarket_id);
    else if (!loading) localStorage.removeItem(STORE_KEY);
  }, [activeStore, loading]);

  const selectStore = useCallback(
    (storeId: string) => {
      if (memberships.some((m) => m.supermarket_id === storeId)) setActiveStoreId(storeId);
    },
    [memberships],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    localStorage.removeItem(STORE_KEY);
  }, []);

  const value: AuthContextValue = {
    loading,
    session,
    profile,
    memberships,
    isSuperAdmin: profile?.is_super_admin ?? false,
    activeStore,
    activeRole: activeStore?.role ?? null,
    blockedMessage,
    selectStore,
    signOut,
    clearBlockedMessage: () => setBlockedMessage(null),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
