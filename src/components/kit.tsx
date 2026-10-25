import { useEffect, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { ChevronLeft, ChevronRight, Inbox, X } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/utils/cn';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-ink-900/40" aria-label="Close" onClick={onClose} />
      <div className={cn('relative max-h-[90vh] w-full overflow-y-auto rounded-xl bg-white p-6 shadow-xl', wide ? 'max-w-2xl' : 'max-w-md')}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel, danger, loading, onConfirm, onClose }: {
  title: string; message: string; confirmLabel: string; danger?: boolean; loading?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-ink-700">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={onConfirm} loading={loading} className={danger ? 'bg-red-600 hover:bg-red-700' : ''}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

const fieldCls = 'w-full rounded-xl border bg-white px-3.5 text-sm text-ink-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100';
export const SelectField = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { label?: string; error?: string }>(
  function SelectField({ label, error, className, children, ...rest }, ref) {
    return (
      <div>
        {label && <label className="mb-1.5 block text-sm font-medium text-ink-700">{label}</label>}
        <select ref={ref} className={cn(fieldCls, 'h-11', error ? 'border-red-500' : 'border-ink-300', className)} {...rest}>{children}</select>
        {error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
      </div>
    );
  });
export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string }>(
  function TextArea({ label, error, className, ...rest }, ref) {
    return (
      <div>
        {label && <label className="mb-1.5 block text-sm font-medium text-ink-700">{label}</label>}
        <textarea ref={ref} rows={3} className={cn(fieldCls, 'py-2.5', error ? 'border-red-500' : 'border-ink-300', className)} {...rest} />
        {error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
      </div>
    );
  });

export function Badge({ tone = 'gray', children }: { tone?: 'gray' | 'green' | 'amber' | 'red' | 'blue'; children: ReactNode }) {
  const t = { gray: 'bg-slate-100 text-ink-700', green: 'bg-green-100 text-green-800', amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-800', blue: 'bg-brand-100 text-brand-800' };
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', t[tone])}>{children}</span>;
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-ink-300 bg-white px-6 py-14 text-center">
      <Inbox className="h-8 w-8 text-ink-300" />
      <p className="mt-3 font-medium">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-ink-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message = 'Could not load this data.', onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      {message} {onRetry && <button onClick={onRetry} className="ml-1 font-semibold underline">Try again</button>}
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card"><table className="w-full min-w-[40rem] text-left text-sm">{children}</table></div>;
}
export const Th = ({ children, right }: { children?: ReactNode; right?: boolean }) =>
  <th className={cn('border-b border-slate-200 bg-slate-50 px-4 py-3 font-medium text-ink-500', right && 'text-right')}>{children}</th>;
export const Td = ({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) =>
  <td className={cn('border-b border-slate-100 px-4 py-3 align-middle', right && 'text-right tabular-nums', className)}>{children}</td>;

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-ink-500">
      <span>{page * pageSize + 1}-{Math.min(total, (page + 1) * pageSize)} of {total}</span>
      <div className="flex items-center gap-1">
        <Button variant="secondary" className="h-9 px-2" disabled={page === 0} onClick={() => onChange(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
        <span className="px-2">Page {page + 1} of {pages}</span>
        <Button variant="secondary" className="h-9 px-2" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return <div className="space-y-2">{Array.from({ length: rows }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-200" />)}</div>;
}
