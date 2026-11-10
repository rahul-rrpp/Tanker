import type { Metadata } from 'next';
import { DashboardShell, Placeholder } from '@/components/dashboard/DashboardShell';
import { requireUser } from '@/lib/server-auth';

export const metadata: Metadata = { title: 'Operations' };

export default async function OperationsDashboard() {
  const { user } = await requireUser({ roles: ['AGENCY_OWNER', 'AGENCY_MANAGER', 'DISPATCHER'], requireApprovedAgency: true });
  return (
    <DashboardShell user={user} title="Operations" subtitle="Dispatch and trip operations.">
      <Placeholder>Dispatch, trips and live tracking modules will appear here in a later phase.</Placeholder>
    </DashboardShell>
  );
}
