import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { addDaysISO, todayISO } from '@/lib/format';
import { NavLink, Outlet } from 'react-router-dom';
import { Bell, ChevronDown, LogOut, Menu, ShoppingBasket, X } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { NAV_ITEMS, navForUser } from '@/lib/navigation';
import { cn } from '@/utils/cn';

const ROLE_LABEL = { admin: 'Supermarket admin', stock_staff: 'Stock staff', cashier: 'Cashier' } as const;

export function AppLayout() {
  const { profile, isSuperAdmin, memberships, activeStore, activeRole, selectStore, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const items = navForUser(NAV_ITEMS, { isSuperAdmin, role: activeRole });
  const roleText = isSuperAdmin ? 'Super admin' : activeRole ? ROLE_LABEL[activeRole] : 'No role assigned';

  const nav = (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Main">
      {items.map(({ to, label, icon: Icon, section }, idx) => (
        <div key={to}>
        {isSuperAdmin && activeRole === null ? null : section && section !== items[idx - 1]?.section && idx > 0 && <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-ink-500">{section}</p>}
        <NavLink
          key={to}
          to={to}
          end
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cn(
              'flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium',
              isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-slate-100',
            )
          }
        >
          <Icon className="h-5 w-5" />
          {label}
        </NavLink>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="hidden border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <Brand />
        {nav}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-ink-900/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="rounded-lg p-2 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-lg p-2 hover:bg-slate-100 lg:hidden">
            <Menu className="h-5 w-5" />
          </button>

          {memberships.length > 1 ? (
            <select
              aria-label="Switch supermarket"
              value={activeStore?.supermarket_id ?? ''}
              onChange={(e) => selectStore(e.target.value)}
              className="h-10 max-w-[12rem] rounded-xl border border-ink-300 bg-white px-3 text-sm font-medium"
            >
              {memberships.map((m) => (
                <option key={m.supermarket_id} value={m.supermarket_id}>
                  {m.supermarket.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="truncate text-sm font-semibold">{activeStore?.supermarket.name ?? (isSuperAdmin ? 'Platform' : 'No supermarket')}</span>
          )}

          <div className="ml-auto flex items-center gap-1">
            <NotificationsBell />
            <div className="relative">
              <button
                onClick={() => setMenu((v) => !v)}
                aria-expanded={menu}
                className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-slate-100"
              >
                <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                  {(profile?.full_name || '?').charAt(0).toUpperCase()}
                </span>
                <span className="hidden text-left sm:block">
                  <span className="block text-sm font-medium leading-tight">{profile?.full_name || 'Account'}</span>
                  <span className="block text-xs text-ink-500">{roleText}</span>
                </span>
                <ChevronDown className="h-4 w-4 text-ink-500" />
              </button>
              {menu && (
                <div className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                  <button
                    onClick={() => void signOut()}
                    className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-sm text-ink-700 hover:bg-slate-100"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex h-16 items-center gap-3 px-5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white">
        <ShoppingBasket className="h-5 w-5" />
      </span>
      <span className="font-semibold">Supermarket POS</span>
    </div>
  );
}


function NotificationsBell() {
  const { activeStore, activeRole } = useAuth();
  const [open, setOpen] = useState(false);
  const enabled = !!activeStore && (activeRole === 'admin' || activeRole === 'stock_staff');
  const storeId = activeStore?.supermarket_id ?? '';
  const q = useQuery({
    queryKey: ['inventory', 'alerts', storeId], enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory_overview').select('name, available, min_stock, next_expiry').eq('supermarket_id', storeId).eq('is_active', true);
      if (error) throw error;
      return data as Array<{ name: string; available: number; min_stock: number; next_expiry: string | null }>;
    },
  });
  const days = useQuery({ queryKey: ['expiry-days', storeId], enabled, queryFn: async () => { const { data, error } = await supabase.from('store_settings').select('expiry_warning_days').eq('supermarket_id', storeId).single(); if (error) throw error; return data.expiry_warning_days as number; } });
  const warnBy = addDaysISO(todayISO(), days.data ?? 30);
  const low = (q.data ?? []).filter((p) => Number(p.available) <= Number(p.min_stock)).length;
  const exp = (q.data ?? []).filter((p) => p.next_expiry && p.next_expiry <= warnBy).length;
  const count = low + exp;
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} disabled={!enabled} aria-label={enabled ? `Notifications (${count})` : 'Notifications'} className="relative rounded-lg p-2 text-ink-500 hover:bg-slate-100 disabled:opacity-50">
        <Bell className="h-5 w-5" />
        {count > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">{count}</span>}
      </button>
      {open && enabled && (
        <div className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-lg">
          {count === 0 ? <p className="text-ink-500">No alerts. Stock levels and expiry dates look fine.</p> : <ul className="space-y-2">
            {low > 0 && <li><Link onClick={() => setOpen(false)} to="/inventory" className="font-medium text-brand-700">{low} product{low > 1 ? 's' : ''} low or out of stock</Link></li>}
            {exp > 0 && <li><Link onClick={() => setOpen(false)} to="/inventory" className="font-medium text-brand-700">{exp} product{exp > 1 ? 's' : ''} expiring soon</Link></li>}
          </ul>}
        </div>
      )}
    </div>
  );
}
