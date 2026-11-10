import type { Metadata } from 'next';
import { AccountSecurity } from '@/components/dashboard/AccountSecurity';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { Card } from '@/components/ui/primitives';
import { requireUser, serverApi } from '@/lib/server-auth';
import { ROLE_LABELS } from '@/lib/types';

export const metadata: Metadata = { title: 'Account & security' };

export default async function AccountPage() {
  const { user } = await requireUser({ next: '/account' });
  const profile = (await serverApi<{ profile: { hasPassword: boolean } }>('/users/profile')).body?.data.profile;
  const emailLabel = user.email ? `${user.email}${user.isEmailVerified ? '' : ' (unverified)'}` : '—';
  return (
    <DashboardShell user={user} title="Account & security">
      <Card className="mb-6">
        <dl className="grid gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted">Name</dt>
            <dd className="font-medium">{user.fullName}</dd>
          </div>
          <div>
            <dt className="text-muted">Mobile</dt>
            <dd className="font-medium">+91 {user.phone}</dd>
          </div>
          <div>
            <dt className="text-muted">Email</dt>
            <dd className="break-all font-medium">{emailLabel}</dd>
          </div>
          <div>
            <dt className="text-muted">Role</dt>
            <dd className="font-medium">{user.roles.map((r) => ROLE_LABELS[r]).join(', ')}</dd>
          </div>
        </dl>
      </Card>
      <AccountSecurity hasPassword={profile?.hasPassword ?? true} />
    </DashboardShell>
  );
}
