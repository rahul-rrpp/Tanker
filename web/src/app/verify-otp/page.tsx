import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthHeading, AuthShell } from '@/components/auth/AuthShell';
import { VerifyOtpForm } from './VerifyOtpForm';

export const metadata: Metadata = { title: 'Verify OTP' };

export default async function VerifyOtpPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string; next?: string; cooldown?: string }>;
}) {
  const { phone, next, cooldown } = await searchParams;
  if (!phone || !/^[6-9]\d{9}$/.test(phone)) redirect('/login');
  const masked = `+91 ••••••${phone.slice(-4)}`;
  return (
    <AuthShell>
      <AuthHeading title="Enter verification code" subtitle={<>If {masked} is registered, we&apos;ve sent it a 6-digit code. It expires in 5 minutes.</>} />
      <VerifyOtpForm phone={phone} next={next} initialCooldown={Number(cooldown) || 45} />
      <p className="mt-8 text-center text-sm text-muted">
        Wrong number?{' '}
        <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-700">
          Go back
        </Link>
      </p>
    </AuthShell>
  );
}
