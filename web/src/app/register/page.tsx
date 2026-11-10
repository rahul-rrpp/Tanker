import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthHeading, AuthShell } from '@/components/auth/AuthShell';
import { CompanyRegistrationForm } from './CompanyRegistrationForm';

export const metadata: Metadata = { title: 'Register your company' };

export default function RegisterPage() {
  return (
    <AuthShell wide>
      <AuthHeading title="Register your company" subtitle="Takes about 3 minutes. Keep your GSTIN handy — we verify your mobile number and email." />
      <CompanyRegistrationForm />
      <p className="mt-8 text-center text-sm text-muted">
        Already registered?{' '}
        <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-700">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
