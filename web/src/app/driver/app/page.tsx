import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Smartphone } from 'lucide-react';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { Card } from '@/components/ui/primitives';
import { requireUser } from '@/lib/server-auth';

export const metadata: Metadata = { title: 'Driver' };

export default async function DriverAppPage() {
  const { user, redirectTo } = await requireUser({ roles: ['DRIVER'] });
  if (redirectTo === '/pending-verification') redirect(redirectTo);
  return (
    <DashboardShell user={user} title="Use the TTMS Driver app" subtitle="Trips, navigation and proof of delivery live in the mobile app.">
      <Card className="flex items-start gap-4">
        <Smartphone className="mt-1 h-8 w-8 shrink-0 text-brand-600" aria-hidden />
        <p className="text-sm text-muted">
          Install the TTMS mobile app and sign in with your mobile number <strong className="text-ink">{user.phone}</strong> using an OTP.
          Your account is verified and linked to {user.agency?.companyName ?? 'your agency'}.
        </p>
      </Card>
    </DashboardShell>
  );
}
