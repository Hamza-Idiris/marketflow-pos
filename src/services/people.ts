import { supabase } from '@/lib/supabase';
import type { Role } from '@/types/database';

export async function inviteUser(args: { store: string; email: string; full_name: string; role: Role; max_discount?: number }) {
  const { data, error } = await supabase.functions.invoke('invite-user', { body: args });
  if (error) {
    // Edge function errors carry a JSON body with a readable message.
    let msg = error.message;
    try { const b = await (error as unknown as { context: Response }).context.json(); if (b?.error) msg = b.error; } catch { /* keep generic */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
