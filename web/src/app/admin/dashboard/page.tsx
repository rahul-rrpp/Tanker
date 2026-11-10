import type { Metadata } from 'next';
import { AgencyApprovals } from '@/components/dashboard/AgencyApprovals';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { requireUser } from '@/lib/server-auth';

export const metadata: Metadata = { title: 'Super Admin' };

export default async function AdminDashboard() {
  const { user } = await requireUser({ roles: ['SUPER_ADMIN'] });
  return (
    <DashboardShell user={user} title="Super Admin" subtitle="Review and verify transport agency registrations.">
      <AgencyApprovals />
    </DashboardShell>
  );
}
