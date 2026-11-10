import type { Metadata } from 'next';
import { EmployeeShell } from '@/components/employee/kit';
import { requireUser } from '@/lib/server-auth';

export const metadata: Metadata = { title: { default: 'Employee Portal', template: '%s · TankerLink' } };

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser({ roles: ['EMPLOYEE'], next: '/employee/dashboard' });
  return <EmployeeShell name={user.fullName}>{children}</EmployeeShell>;
}
