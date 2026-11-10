import { requireUser } from '@/lib/server-auth';

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  await requireUser({ roles: ['DRIVER'], next: '/driver/app' });
  return children;
}
