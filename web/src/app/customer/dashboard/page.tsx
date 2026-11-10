import type { Metadata } from 'next';
import { DashboardShell, Placeholder } from '@/components/dashboard/DashboardShell';
import { requireUser } from '@/lib/server-auth';

export const metadata: Metadata = { title: 'My bookings' };

export default async function CustomerDashboard() {
  const { user } = await requireUser({ roles: ['CUSTOMER'] });
  const firstName = user.fullName.split(' ')[0];
  return (
    <DashboardShell user={user} title={`Hello, ${firstName}`} subtitle="Your tanker bookings.">
      <Placeholder>Tanker booking will be available here in a later phase.</Placeholder>
    </DashboardShell>
  );
}
