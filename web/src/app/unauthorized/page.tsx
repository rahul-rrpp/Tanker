import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';

export const metadata: Metadata = { title: 'Access denied' };

export default function UnauthorizedPage() {
  return (
    <AuthShell>
      <div className="text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-danger">
          <ShieldAlert className="h-7 w-7" aria-hidden />
        </span>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-sm text-muted">Your account role doesn&apos;t include permission for this area. If you think this is a mistake, contact your agency owner or TTMS support.</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/" className="inline-flex h-11 items-center justify-center rounded-[var(--radius-field)] bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700">
            Go to my dashboard
          </Link>
          <Link href="/login" className="inline-flex h-11 items-center justify-center rounded-[var(--radius-field)] border border-line bg-white px-5 text-sm font-semibold hover:bg-canvas">
            Sign in as someone else
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
