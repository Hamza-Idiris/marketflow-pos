import type { Currency } from '@/types/database';

export function formatMoney(amount: number | string | null | undefined, currency: Currency): string {
  const n = Number(amount ?? 0);
  return currency === 'SOS'
    ? `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })} SOS`
    : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export const formatQty = (n: number | string | null | undefined) => Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
export const formatDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Mogadishu', dateStyle: 'medium', timeStyle: 'short' }) : '';
export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-GB', { dateStyle: 'medium', timeZone: 'Africa/Mogadishu' }) : '';
/** Today's date (YYYY-MM-DD) in Mogadishu, matching the database's store_today(). */
export const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Mogadishu' }).format(new Date());
export function addDaysISO(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const METHOD_LABEL: Record<string, string> = { cash: 'Cash', evc_plus: 'EVC Plus', sahal: 'Sahal', zaad: 'Zaad' };
