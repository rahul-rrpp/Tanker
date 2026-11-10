import type { Metadata } from 'next';
import { DriverShell } from '@/components/transporter/Shell';
import { requireUser } from '@/lib/server-auth';

export const metadata: Metadata = { title: { default: 'Driver', template: '%s · TankerLink' } };

export default async function DriverPortalLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser({ roles: ['DRIVER'], next: '/driver/dashboard' });
  return <DriverShell name={user.fullName}>{children}</DriverShell>;
}
