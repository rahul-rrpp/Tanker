import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthHeading, AuthShell } from '@/components/auth/AuthShell';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

const NOTICES: Record<string, string> = {
  expired: 'Your session has expired. Please sign in again.',
  reset: 'Password updated. Sign in with your new password.',
  logout: 'You have been signed out.',
};

const transporterOpen = (process.env.NEXT_PUBLIC_ENABLED_PORTALS ?? '').split(',').map((s) => s.trim()).includes('transporter');

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const { next, reason } = await searchParams;
  return (
    <AuthShell>
      <AuthHeading title={transporterOpen ? 'Sign in to TankerLink' : 'Company sign in'} subtitle={transporterOpen ? 'For companies, transporters and drivers.' : 'Book tankers, compare transporter offers and track your loads.'} />
      <LoginForm next={next} notice={reason ? NOTICES[reason] : undefined} />
      <p className="mt-8 text-center text-sm text-muted">
        New to TankerLink?{' '}
        <Link href="/register" className="font-semibold text-brand-600 hover:text-brand-700">
          Register your company
        </Link>
        {transporterOpen && (
          <>
            {' or '}
            <Link href="/register/transporter" className="font-semibold text-brand-600 hover:text-brand-700">
              your transport business
            </Link>
          </>
        )}
      </p>
    </AuthShell>
  );
}
