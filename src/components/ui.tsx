import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-brand-600', className)} aria-label="Loading" />;
}

export function FullPageSpinner() {
  return (
    <div className="grid min-h-screen place-items-center bg-surface">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
}
export function Button({ variant = 'primary', loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        'inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        variant === 'primary' && 'bg-brand-600 text-white hover:bg-brand-700',
        variant === 'secondary' && 'border border-ink-300 bg-white text-ink-900 hover:bg-slate-50',
        variant === 'ghost' && 'text-ink-700 hover:bg-slate-100',
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ label, error, id, className, ...rest }, ref) {
  const fieldId = id ?? rest.name;
  return (
    <div>
      {label && (
        <label htmlFor={fieldId} className="mb-1.5 block text-sm font-medium text-ink-700">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={fieldId}
        aria-invalid={!!error}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={cn(
          'h-11 w-full rounded-xl border bg-white px-3.5 text-sm text-ink-900 placeholder:text-ink-500 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100',
          error ? 'border-red-500' : 'border-ink-300',
          className,
        )}
        {...rest}
      />
      {error && (
        <p id={`${fieldId}-error`} className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
});

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'success' | 'info'; children: ReactNode }) {
  const tones = {
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-green-200 bg-green-50 text-green-800',
    info: 'border-brand-200 bg-brand-50 text-brand-800',
  };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('rounded-xl border px-3.5 py-3 text-sm', tones[tone])}>
      {children}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-xl border border-slate-200 bg-white p-5 shadow-card', className)}>{children}</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-slate-200', className)} />;
}
