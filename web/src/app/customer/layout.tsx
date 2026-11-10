import { requireUser } from '@/lib/server-auth';

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  await requireUser({ roles: ['CUSTOMER'], next: '/customer/dashboard' });
  return children;
}
