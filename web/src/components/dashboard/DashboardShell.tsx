import Link from 'next/link';
import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { AuthUser } from '@/lib/types';
import { ROLE_LABELS } from '@/lib/types';
import { Logo } from '../ui/Logo';
import { LogoutButton } from './LogoutButton';

export function DashboardShell({ user, title, subtitle, children }: { user: AuthUser; title: string; subtitle?: string; children: ReactNode }) {
  const initials = user.fullName
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" aria-label="Dashboard home">
            <Logo />
          </Link>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link href="/account" className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-canvas" aria-label="Account and security">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white" aria-hidden>
                {initials}
              </span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-sm font-semibold text-ink">{user.fullName}</span>
                <span className="block text-xs text-muted">{user.roles.map((r) => ROLE_LABELS[r]).join(', ')}</span>
              </span>
            </Link>
            <LogoutButton variant="ghost" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          </div>
          {user.agency && (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted">
              <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
              {user.agency.companyName}
            </span>
          )}
        </div>
        {children}
      </main>
    </div>
  );
}

export function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-white p-8 text-center text-sm text-muted">{children}</div>
  );
}
