import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { forgotSchema, type ForgotValues } from '@/schemas/auth';
import { Alert, Button, Field } from '@/components/ui';
import { AuthShell } from './AuthShell';

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotValues>({ resolver: zodResolver(forgotSchema) });

  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (err) return setError(friendlyError(err));
    setSent(true);
  });

  return (
    <AuthShell title="Reset your password" subtitle="Enter your email and we will send you a reset link.">
      {sent ? (
        <Alert tone="success">If an account exists for that email, a reset link is on its way.</Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="text-center text-sm">
        <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
