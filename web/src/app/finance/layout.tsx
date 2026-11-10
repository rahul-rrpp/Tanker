import { requireUser } from '@/lib/server-auth';

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  await requireUser({ roles: ['FINANCE_MANAGER', 'AGENCY_OWNER'], requireApprovedAgency: true, next: '/finance/dashboard' });
  return children;
}
