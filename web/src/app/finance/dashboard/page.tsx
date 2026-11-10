import type { Metadata } from 'next';
import { DashboardShell, Placeholder } from '@/components/dashboard/DashboardShell';
import { requireUser } from '@/lib/server-auth';

export const metadata: Metadata = { title: 'Finance' };

export default async function FinanceDashboard() {
  const { user } = await requireUser({ roles: ['FINANCE_MANAGER', 'AGENCY_OWNER'], requireApprovedAgency: true });
  return (
    <DashboardShell user={user} title="Finance" subtitle="Invoices, payments and settlements.">
      <Placeholder>Billing and payments modules will appear here in a later phase.</Placeholder>
    </DashboardShell>
  );
}
