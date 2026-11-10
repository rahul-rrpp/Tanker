import { requireUser } from '@/lib/server-auth';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireUser({ roles: ['SUPER_ADMIN'], next: '/admin/dashboard' });
  return children;
}
