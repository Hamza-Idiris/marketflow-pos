import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('quotes commas and escapes quotes', () => {
    expect(toCsv([{ a: 'x,y', b: 'say "hi"' }])).toBe('a,b\n"x,y","say ""hi"""');
  });
  it('neutralises formulas', () => {
    expect(toCsv([{ a: '=SUM(A1)' }])).toBe("a\n'=SUM(A1)");
  });
  it('returns empty text for no rows', () => expect(toCsv([])).toBe(''));
});
