import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthHeading, AuthShell } from '@/components/auth/AuthShell';
import { SignupForm } from './SignupForm';

export const metadata: Metadata = { title: 'Create an account' };

export default function SignupPage() {
  return (
    <AuthShell>
      <AuthHeading title="Create your account" subtitle="Your mobile number and a password are all you need." />
      <SignupForm />
      <p className="mt-8 text-center text-sm text-muted">
        Already registered?{' '}
        <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-700">
          Sign in
        </Link>
      </p>
      <p className="mt-3 text-center text-sm text-muted">
        Registering a business?{' '}
        <Link href="/signup/agency" className="font-medium text-brand-600 hover:text-brand-700">
          Transport agency
        </Link>{' '}
        ·{' '}
        <Link href="/signup/driver" className="font-medium text-brand-600 hover:text-brand-700">
          Driver
        </Link>
      </p>
    </AuthShell>
  );
}
