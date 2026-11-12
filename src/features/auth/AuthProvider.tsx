import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import toast from 'react-hot-toast';
import { supabase } from '@/lib/supabase';
import type { AccessGrant, Membership, Profile, Role } from '@/types/database';

const STORE_KEY = 'pos.activeStore';

interface AuthContextValue {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  memberships: Membership[];
  isSuperAdmin: boolean;
  activeStore: Membership | null;
  activeRole: Role | null;
  isSupportView: boolean;
  activeGrant: AccessGrant | null;
  activeGrants: AccessGrant[];
  blockedMessage: string | null;
  selectStore: (storeId: string) => void;
  refetchGrants: () => Promise<void>;
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

async function loadActiveGrants(userId: string, isSuper: boolean): Promise<AccessGrant[]> {
  if (!isSuper) return [];
  const { data, error } = await supabase
    .from('access_grants')
    .select('id, supermarket_id, requested_by, reason, status, decided_by, decided_at, expires_at, created_at, supermarket:supermarkets(id, name, is_active)')
    .eq('requested_by', userId)
    .eq('status', 'approved')
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false });
  if (error) {
    console.error('Failed to load access grants', error);
    return [];
  }
  return (data ?? []) as unknown as AccessGrant[];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeGrants, setActiveGrants] = useState<AccessGrant[]>([]);
  const [activeStoreId, setActiveStoreId] = useState<string | null>(() => localStorage.getItem(STORE_KEY));
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  const reset = useCallback(() => {
    setProfile(null);
    setMemberships([]);
    setActiveGrants([]);
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
          if (ctx.profile.is_super_admin) {
            const grants = await loadActiveGrants(s.user.id, true);
            setActiveGrants(grants);
          } else {
            setActiveGrants([]);
          }
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

  const refetchGrants = useCallback(async () => {
    if (!profile?.is_super_admin || !session?.user.id) return;
    const grants = await loadActiveGrants(session.user.id, true);
    setActiveGrants(grants);
  }, [profile?.is_super_admin, session?.user.id]);

  const isSuperAdmin = profile?.is_super_admin ?? false;

  // Active grant matching current activeStoreId if super admin
  const activeGrant = useMemo(() => {
    if (!isSuperAdmin) return null;
    return activeGrants.find((g) => g.supermarket_id === activeStoreId && g.expires_at && new Date(g.expires_at) > new Date()) ?? null;
  }, [isSuperAdmin, activeGrants, activeStoreId]);

  const isSupportView = Boolean(isSuperAdmin && activeGrant);

  // Active store resolution
  const activeStore = useMemo<Membership | null>(() => {
    // 1. Regular membership matches
    const regular = memberships.find((m) => m.supermarket_id === activeStoreId);
    if (regular) return regular;

    // 2. Super admin support view grant matches
    if (isSuperAdmin && activeGrant && activeGrant.supermarket) {
      return {
        id: `support-${activeGrant.id}`,
        supermarket_id: activeGrant.supermarket_id,
        role: 'admin',
        cashier_max_discount_pct: 0,
        supermarket: activeGrant.supermarket,
      };
    }

    // 3. Fallback to first membership or null
    return memberships[0] ?? null;
  }, [memberships, activeStoreId, isSuperAdmin, activeGrant]);

  // Handle grant expiry: when current store was selected under a grant that expired
  useEffect(() => {
    if (isSuperAdmin && activeStoreId && !memberships.some((m) => m.supermarket_id === activeStoreId)) {
      const grantStillActive = activeGrants.some((g) => g.supermarket_id === activeStoreId && g.expires_at && new Date(g.expires_at) > new Date());
      if (!grantStillActive && activeGrants.length === 0 && !loading) {
        // Expired!
        setActiveStoreId(null);
        localStorage.removeItem(STORE_KEY);
        toast.error('Support access grant has expired. Switched back to Platform view.');
      }
    }
  }, [isSuperAdmin, activeStoreId, memberships, activeGrants, loading]);

  // Periodic poll to check grant expiry every 10 seconds
  useEffect(() => {
    if (!isSuperAdmin || activeGrants.length === 0) return;
    const interval = setInterval(() => {
      const now = new Date();
      const stillValid = activeGrants.filter((g) => g.expires_at && new Date(g.expires_at) > now);
      if (stillValid.length !== activeGrants.length) {
        setActiveGrants(stillValid);
        if (activeStoreId && !stillValid.some((g) => g.supermarket_id === activeStoreId) && !memberships.some((m) => m.supermarket_id === activeStoreId)) {
          setActiveStoreId(null);
          localStorage.removeItem(STORE_KEY);
          toast.error('Support access grant has expired. Switched back to Platform view.');
        }
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [isSuperAdmin, activeGrants, activeStoreId, memberships]);

  useEffect(() => {
    if (activeStore) localStorage.setItem(STORE_KEY, activeStore.supermarket_id);
    else if (!loading && !isSuperAdmin) localStorage.removeItem(STORE_KEY);
  }, [activeStore, loading, isSuperAdmin]);

  const selectStore = useCallback(
    (storeId: string) => {
      if (storeId === '') {
        setActiveStoreId(null);
        localStorage.removeItem(STORE_KEY);
        return;
      }
      if (memberships.some((m) => m.supermarket_id === storeId)) {
        setActiveStoreId(storeId);
      } else if (isSuperAdmin && activeGrants.some((g) => g.supermarket_id === storeId && g.expires_at && new Date(g.expires_at) > new Date())) {
        setActiveStoreId(storeId);
      }
    },
    [memberships, isSuperAdmin, activeGrants],
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
    isSuperAdmin,
    activeStore,
    activeRole: isSupportView ? 'admin' : (activeStore?.role ?? null),
    isSupportView,
    activeGrant,
    activeGrants,
    blockedMessage,
    selectStore,
    refetchGrants,
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
