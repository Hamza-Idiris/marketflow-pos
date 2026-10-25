import type { Currency } from '@/types/database';

// Display-side helpers only. The database recalculates everything at checkout.
export const roundMoney = (n: number, c: Currency) => (c === 'SOS' ? Math.round(n) : Math.round((n + Number.EPSILON) * 100) / 100);
const minor = (n: number, c: Currency) => (c === 'SOS' ? Math.round(n) : Math.round(n * 100));

/** Convert using the store convention: rate = SOS per 1 USD. */
export function convert(amount: number, from: Currency, to: Currency, rate: number | null): number | null {
  if (from === to) return amount;
  if (!rate || rate <= 0) return null;
  return roundMoney(from === 'USD' ? amount * rate : amount / rate, to);
}
export const sameAmount = (a: number, b: number, c: Currency) => minor(a, c) === minor(b, c);

export function lineTotals(qty: number, unitPrice: number, discountPct: number, c: Currency) {
  const subtotal = roundMoney(qty * unitPrice, c);
  const discount = roundMoney((subtotal * discountPct) / 100, c);
  return { subtotal, discount, total: roundMoney(subtotal - discount, c) };
}
