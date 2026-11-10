import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthHeading, AuthShell } from '@/components/auth/AuthShell';
import { AgencySignupForm } from './AgencySignupForm';

export const metadata: Metadata = { title: 'Register your agency' };

export default function AgencySignupPage() {
  return (
    <AuthShell wide>
      <AuthHeading title="Register your transport agency" subtitle="Three quick steps. Keep your PAN and GST details handy." />
      <AgencySignupForm emailVerificationRequired={process.env.NEXT_PUBLIC_EMAIL_VERIFICATION_REQUIRED === 'true'} />
      <p className="mt-8 text-center text-sm text-muted">
        Not an agency?{' '}
        <Link href="/signup" className="font-semibold text-brand-600 hover:text-brand-700">
          Choose another account type
        </Link>
      </p>
    </AuthShell>
  );
}
