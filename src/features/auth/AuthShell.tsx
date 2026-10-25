import type { ReactNode } from 'react';
import { ShoppingBasket } from 'lucide-react';

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-surface px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white">
            <ShoppingBasket className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold text-ink-900">Supermarket POS</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
        <p className="mt-1.5 text-sm text-ink-500">{subtitle}</p>
        <div className="mt-6 space-y-4">{children}</div>
      </div>
    </main>
  );
}
