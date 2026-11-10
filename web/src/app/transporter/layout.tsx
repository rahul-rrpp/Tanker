import type { Metadata } from 'next';
import { TransporterShell } from '@/components/transporter/Shell';
import { requireUser } from '@/lib/server-auth';

export const metadata: Metadata = { title: { default: 'Transporter Portal', template: '%s · TankerLink' } };

export default async function TransporterLayout({ children }: { children: React.ReactNode }) {
  // Authorisation comes from the backend's view of the user; every API call re-checks it.
  const { user } = await requireUser({ roles: ['AGENCY_OWNER', 'AGENCY_MANAGER', 'DISPATCHER', 'FINANCE_MANAGER'], next: '/transporter/dashboard' });
  return <TransporterShell user={user}>{children}</TransporterShell>;
}
