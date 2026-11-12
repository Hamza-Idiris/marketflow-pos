import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { Alert, Button, Field } from '@/components/ui';
import { AuthShell } from './AuthShell';

const signUpSchema = z.object({
  full_name: z.string().trim().min(2, 'Enter your full name'),
  email: z.string().trim().min(1, 'Enter your email').email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters'),
});
type SignUpValues = z.infer<typeof signUpSchema>;

export function SignUpPage() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<SignUpValues>({ resolver: zodResolver(signUpSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    const { error: err } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        data: { full_name: values.full_name },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    if (err) return setError(friendlyError(err));
    setDone(true);
  });

  if (done) {
    return (
      <AuthShell title="Check your email" subtitle="One more step to get in.">
        <p className="text-sm text-ink-700">
          Check your email and open the confirmation link, then sign in.
        </p>
        <p className="text-center text-sm">
          <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">Back to sign in</Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create account" subtitle="Sign up with the email address your administrator invited.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Full name" autoComplete="name" error={errors.full_name?.message} {...register('full_name')} />
        <Field label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <Field label="Password" type="password" autoComplete="new-password" error={errors.password?.message} {...register('password')} />
        <Button type="submit" className="w-full" loading={isSubmitting}>Create account</Button>
      </form>
      <p className="text-center text-sm">
        <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">Already have an account? Sign in</Link>
      </p>
    </AuthShell>
  );
}
