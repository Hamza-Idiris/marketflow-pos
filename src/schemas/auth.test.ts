import { describe, expect, it } from 'vitest';
import { loginSchema, resetSchema } from './auth';

describe('auth schemas', () => {
  it('rejects an invalid email', () => {
    expect(loginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
  });
  it('accepts valid login input and trims the email', () => {
    const r = loginSchema.safeParse({ email: '  a@b.co ', password: 'x' });
    expect(r.success && r.data.email).toBe('a@b.co');
  });
  it('requires matching passwords of 8+ characters', () => {
    expect(resetSchema.safeParse({ password: 'short', confirm: 'short' }).success).toBe(false);
    expect(resetSchema.safeParse({ password: 'longenough1', confirm: 'different1' }).success).toBe(false);
    expect(resetSchema.safeParse({ password: 'longenough1', confirm: 'longenough1' }).success).toBe(true);
  });
});
