import { rpc } from '@/lib/rpc';
import type { Role } from '@/types/database';

export async function inviteMember(args: {
  store: string;
  email: string;
  full_name: string;
  role: Role;
  max_discount?: number;
}): Promise<'added' | 'invited'> {
  return rpc<'added' | 'invited'>('invite_member', {
    p_store: args.store,
    p_email: args.email,
    p_full_name: args.full_name,
    p_role: args.role,
    p_max_discount: args.role === 'cashier' ? (args.max_discount ?? 0) : 0,
  });
}

export function inviteMessage(result: 'added' | 'invited'): string {
  if (result === 'added') return 'Added. They can sign in now.';
  return 'Invitation saved. Ask them to create an account with this exact email, then sign in.';
}
