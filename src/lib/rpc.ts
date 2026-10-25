import { supabase } from './supabase';

/** Calls a database function and throws a normal Error on failure. */
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
/** Database errors that are written for people (our RPCs raise readable messages) are shown as-is. */
export function dbMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : '';
  if (m.includes('duplicate key') && m.includes('barcode')) return 'Another product in this store already uses that barcode.';
  if (m.includes('duplicate key') && m.includes('sku')) return 'Another product in this store already uses that SKU.';
  if (m.includes('duplicate key')) return 'That already exists.';
  if (m.includes('permission denied') || m.includes('row-level security')) return 'You do not have permission to do that.';
  if (m.includes('Failed to fetch')) return 'Cannot reach the server. Check your internet connection.';
  // Messages raised by our own functions are plain English; show them. Anything long or technical is hidden.
  return m && m.length < 160 && !/[{}]|violates|constraint|syntax/.test(m) ? m : 'Something went wrong. Please try again.';
}
