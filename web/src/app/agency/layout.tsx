import { requireUser } from '@/lib/server-auth';

export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  await requireUser({ roles: ['AGENCY_OWNER', 'AGENCY_MANAGER', 'DISPATCHER'], requireApprovedAgency: true, next: '/agency/dashboard' });
  return children;
}
