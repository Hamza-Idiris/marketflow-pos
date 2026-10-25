import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const forgotSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('Enter a valid email address'),
});
export type ForgotValues = z.infer<typeof forgotSchema>;

export const resetSchema = z
  .object({
    password: z.string().min(8, 'Use at least 8 characters'),
    confirm: z.string().min(1, 'Repeat the new password'),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });
export type ResetValues = z.infer<typeof resetSchema>;
