import type { Metadata } from 'next';
import { PortalShell } from '@/components/portal/PortalShell';
import { requireUser } from '@/lib/server-auth';

export const metadata: Metadata = { title: { default: 'Company Portal', template: '%s · TankerLink' } };

export default async function CompanyLayout({ children }: { children: React.ReactNode }) {
  // Authorisation is decided by the backend's view of the user (roles + company membership).
  const { user } = await requireUser({ roles: ['COMPANY_ADMIN', 'COMPANY_USER'], next: '/company/dashboard' });
  return <PortalShell user={user}>{children}</PortalShell>;
}
