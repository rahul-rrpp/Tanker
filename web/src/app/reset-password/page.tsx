import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthHeading, AuthShell } from '@/components/auth/AuthShell';
import { ResetPasswordForm } from './ResetPasswordForm';

export const metadata: Metadata = { title: 'Set a new password' };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ identifier?: string; cooldown?: string }> }) {
  const { identifier, cooldown } = await searchParams;
  if (!identifier) redirect('/forgot-password');
  return (
    <AuthShell>
      <AuthHeading
        title="Set a new password"
        subtitle={<>If an account exists for <strong className="text-ink">{identifier}</strong>, we&apos;ve sent it a 6-digit reset code. You&apos;ll be signed out of all devices.</>}
      />
      <ResetPasswordForm identifier={identifier} initialCooldown={Number(cooldown) || 45} />
      <p className="mt-8 text-center text-sm text-muted">
        <Link href="/forgot-password" className="font-semibold text-brand-600 hover:text-brand-700">
          Use a different account
        </Link>
      </p>
    </AuthShell>
  );
}
