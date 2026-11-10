import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AgencyTeam } from '@/components/dashboard/AgencyTeam';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { requireUser } from '@/lib/server-auth';

export const metadata: Metadata = { title: 'Agency dashboard' };

export default async function AgencyDashboard() {
  const { user } = await requireUser({ roles: ['AGENCY_OWNER', 'AGENCY_MANAGER', 'DISPATCHER'], requireApprovedAgency: true });
  if (!user.roles.some((r) => r === 'AGENCY_OWNER' || r === 'AGENCY_MANAGER')) redirect('/agency/operations');
  return (
    <DashboardShell user={user} title="Agency dashboard" subtitle="Manage driver invitations, driver verification and your team.">
      <AgencyTeam permissions={user.permissions} />
    </DashboardShell>
  );
}
