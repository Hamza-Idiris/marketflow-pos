import { describe, expect, it } from 'vitest';
import { addDaysISO, formatMoney } from './format';

describe('format', () => {
  it('formats USD with cents and SOS without', () => {
    expect(formatMoney(1234.5, 'USD')).toBe('$1,234.50');
    expect(formatMoney(1200, 'SOS')).toBe('1,200 SOS');
  });
  it('adds days across month boundaries', () => {
    expect(addDaysISO('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28');
  });
});
