import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { loginSchema, type LoginValues } from '@/schemas/auth';
import { Alert, Button, Field } from '@/components/ui';
import { AuthShell } from './AuthShell';
import { useAuth } from './AuthProvider';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { blockedMessage, clearBlockedMessage } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    clearBlockedMessage();
    const { error: err } = await supabase.auth.signInWithPassword(values);
    if (err) return setError(friendlyError(err));
    navigate((location.state as { from?: string } | null)?.from ?? '/', { replace: true });
  });

  const message = error ?? blockedMessage;
  return (
    <AuthShell title="Sign in" subtitle="Use the email and password your administrator gave you.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {message && <Alert>{message}</Alert>}
        <Field label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <Field label="Password" type="password" autoComplete="current-password" error={errors.password?.message} {...register('password')} />
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>
      <p className="text-center text-sm">
        <Link to="/forgot-password" className="font-medium text-brand-600 hover:text-brand-700">
          Forgot your password?
        </Link>
      </p>
    </AuthShell>
  );
}
