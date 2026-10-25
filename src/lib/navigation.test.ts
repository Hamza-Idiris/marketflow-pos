import { describe, expect, it } from 'vitest';
import { LayoutDashboard } from 'lucide-react';
import { navForUser, type NavItem } from './navigation';

const items: NavItem[] = [
  { label: 'POS', to: '/pos', icon: LayoutDashboard, roles: ['cashier', 'admin'] },
  { label: 'Receiving', to: '/receiving', icon: LayoutDashboard, roles: ['stock_staff', 'admin'] },
  { label: 'Platform', to: '/platform', icon: LayoutDashboard, roles: [], superAdmin: true },
];

describe('navForUser', () => {
  it('shows cashiers only the POS', () => {
    expect(navForUser(items, { isSuperAdmin: false, role: 'cashier' }).map((i) => i.label)).toEqual(['POS']);
  });
  it('shows stock staff only receiving', () => {
    expect(navForUser(items, { isSuperAdmin: false, role: 'stock_staff' }).map((i) => i.label)).toEqual(['Receiving']);
  });
  it('shows super admins only platform items when they have no store role', () => {
    expect(navForUser(items, { isSuperAdmin: true, role: null }).map((i) => i.label)).toEqual(['Platform']);
  });
  it('shows nothing without a role', () => {
    expect(navForUser(items, { isSuperAdmin: false, role: null })).toEqual([]);
  });
});

import { NAV_ITEMS, canOpen } from './navigation';
describe('route access', () => {
  it('only cashiers reach the POS', () => {
    expect(canOpen('/pos', { isSuperAdmin: false, role: 'cashier' })).toBe(true);
    expect(canOpen('/pos', { isSuperAdmin: false, role: 'stock_staff' })).toBe(false);
    expect(canOpen('/pos', { isSuperAdmin: false, role: 'admin' })).toBe(false);
  });
  it('stock staff cannot see sales, expenses or reports', () => {
    for (const p of ['/sales', '/expenses', '/reports', '/employees', '/settings']) expect(canOpen(p, { isSuperAdmin: false, role: 'stock_staff' })).toBe(false);
  });
  it('cashiers cannot manage products, stock or purchases', () => {
    for (const p of ['/products', '/inventory', '/receiving', '/purchases', '/suppliers']) expect(canOpen(p, { isSuperAdmin: false, role: 'cashier' })).toBe(false);
  });
  it('only super admins reach platform pages', () => {
    expect(canOpen('/supermarkets', { isSuperAdmin: true, role: null })).toBe(true);
    expect(canOpen('/supermarkets', { isSuperAdmin: false, role: 'admin' })).toBe(false);
  });
  it('every nav item has a unique path', () => {
    expect(new Set(NAV_ITEMS.map((i) => i.to)).size).toBe(NAV_ITEMS.length);
  });
});
