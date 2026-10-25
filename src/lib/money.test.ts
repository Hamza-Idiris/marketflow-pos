import { describe, expect, it } from 'vitest';
import { convert, lineTotals, sameAmount } from './money';

describe('money', () => {
  it('converts with SOS per USD', () => {
    expect(convert(1, 'USD', 'SOS', 570)).toBe(570);
    expect(convert(630, 'SOS', 'USD', 630)).toBe(1);
    expect(convert(5, 'USD', 'USD', null)).toBe(5);
    expect(convert(5, 'USD', 'SOS', null)).toBeNull();
  });
  it('avoids binary float drift on cents', () => {
    expect(lineTotals(3, 0.1, 0, 'USD').total).toBe(0.3);
    expect(lineTotals(1, 2, 10, 'USD')).toEqual({ subtotal: 2, discount: 0.2, total: 1.8 });
  });
  it('rounds SOS to whole shillings and compares exactly', () => {
    expect(lineTotals(1, 1200, 15, 'SOS').total).toBe(1020);
    expect(sameAmount(0.1 + 0.2, 0.3, 'USD')).toBe(true);
    expect(sameAmount(1.99, 2, 'USD')).toBe(false);
  });
});
