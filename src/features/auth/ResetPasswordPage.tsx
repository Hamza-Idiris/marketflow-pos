import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { resetSchema, type ResetValues } from '@/schemas/auth';
import { Alert, Button, Field, FullPageSpinner } from '@/components/ui';
import { AuthShell } from './AuthShell';
import { useAuth } from './AuthProvider';

// The emailed link signs the user in with a recovery session; we only need to set the new password.
export function ResetPasswordPage() {
  const { loading, session } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetValues>({ resolver: zodResolver(resetSchema) });

  if (loading) return <FullPageSpinner />;
  if (!session) {
    return (
      <AuthShell title="Link expired" subtitle="This reset link is invalid or has already been used.">
        <Link to="/forgot-password" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  const onSubmit = handleSubmit(async ({ password }) => {
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) return setError(friendlyError(err));
    toast.success('Password updated');
    navigate('/', { replace: true });
  });

  return (
    <AuthShell title="Choose a new password" subtitle="Use at least 8 characters.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="New password" type="password" autoComplete="new-password" error={errors.password?.message} {...register('password')} />
        <Field label="Repeat new password" type="password" autoComplete="new-password" error={errors.confirm?.message} {...register('confirm')} />
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Save password
        </Button>
      </form>
    </AuthShell>
  );
}
