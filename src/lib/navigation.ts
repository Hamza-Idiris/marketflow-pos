import {
  BarChart3, Barcode, Boxes, ClipboardList, LayoutDashboard, PackageCheck, Receipt, ScrollText, Settings, ShoppingCart, Store, Tags, Timer, Truck, Users, Wallet, Package, type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/types/database';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Roles allowed inside a store. */
  roles: Role[];
  /** Visible to platform super admins. */
  superAdmin?: boolean;
  section?: 'Platform' | 'Store management';
}

const ALL: Role[] = ['admin', 'stock_staff', 'cashier'];
export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, roles: ALL, superAdmin: true, section: 'Platform' },
  { label: 'Supermarkets', to: '/supermarkets', icon: Store, roles: [], superAdmin: true, section: 'Platform' },
  { label: 'Platform reports', to: '/platform-reports', icon: BarChart3, roles: [], superAdmin: true, section: 'Platform' },
  { label: 'Audit logs', to: '/audit', icon: ScrollText, roles: ['admin'], superAdmin: true, section: 'Platform' },
  { label: 'Point of sale', to: '/pos', icon: ShoppingCart, roles: ['cashier'], section: 'Store management' },
  { label: 'Sales history', to: '/sales', icon: Receipt, roles: ['admin', 'cashier'], section: 'Store management' },
  { label: 'Products', to: '/products', icon: Package, roles: ['admin', 'stock_staff'], section: 'Store management' },
  { label: 'Categories', to: '/categories', icon: Tags, roles: ['admin'], section: 'Store management' },
  { label: 'Inventory', to: '/inventory', icon: Boxes, roles: ['admin', 'stock_staff'], section: 'Store management' },
  { label: 'Stock receiving', to: '/receiving', icon: PackageCheck, roles: ['admin', 'stock_staff'], section: 'Store management' },
  { label: 'Suppliers', to: '/suppliers', icon: Truck, roles: ['admin', 'stock_staff'], section: 'Store management' },
  { label: 'Purchases', to: '/purchases', icon: ClipboardList, roles: ['admin', 'stock_staff'], section: 'Store management' },
  { label: 'Barcode labels', to: '/labels', icon: Barcode, roles: ['admin', 'stock_staff'], section: 'Store management' },
  { label: 'Expenses', to: '/expenses', icon: Wallet, roles: ['admin'], section: 'Store management' },
  { label: 'Cashier shifts', to: '/shifts', icon: Timer, roles: ['admin', 'cashier'], section: 'Store management' },
  { label: 'Reports', to: '/reports', icon: BarChart3, roles: ['admin'], section: 'Store management' },
  { label: 'Employees and roles', to: '/employees', icon: Users, roles: ['admin'], section: 'Store management' },
  { label: 'Settings', to: '/settings', icon: Settings, roles: ['admin'], section: 'Store management' },
];

export function navForUser(items: NavItem[], opts: { isSuperAdmin: boolean; role: Role | null }): NavItem[] {
  return items.filter((i) => (opts.isSuperAdmin && i.superAdmin) || (opts.role !== null && i.roles.includes(opts.role)));
}

/** Can this user open this route? Used by the route guard (the database enforces the real rules). */
export function canOpen(path: string, opts: { isSuperAdmin: boolean; role: Role | null }): boolean {
  const item = NAV_ITEMS.find((i) => i.to === path);
  return !!item && navForUser([item], opts).length === 1;
}
