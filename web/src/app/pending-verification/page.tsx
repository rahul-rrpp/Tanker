import type { Metadata } from 'next';
import { Clock3, XCircle } from 'lucide-react';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/AuthShell';
import { LogoutButton } from '@/components/dashboard/LogoutButton';
import { Badge } from '@/components/ui/primitives';
import { requireUser, serverApi } from '@/lib/server-auth';
import { STATUS_LABELS, type VerificationStatus } from '@/lib/types';

export const metadata: Metadata = { title: 'Verification pending' };

interface StatusData {
  agency: { companyName: string; verificationStatus: VerificationStatus; rejectionReason: string | null; createdAt: string };
  statusMessage: string;
}

export default async function PendingVerificationPage() {
  const { user, redirectTo } = await requireUser({ next: '/pending-verification' });
  if (redirectTo !== '/pending-verification') redirect(redirectTo);

  const isOwner = user.roles.includes('AGENCY_OWNER');
  const status = isOwner ? (await serverApi<StatusData>('/agency/registration-status')).body?.data : undefined;
  const verification: VerificationStatus =
    status?.agency.verificationStatus ?? user.agency?.verificationStatus ?? user.driverVerificationStatus ?? 'PENDING_VERIFICATION';
  const rejected = verification === 'REJECTED' || verification === 'SUSPENDED';

  const message = status?.statusMessage ??
    (user.roles.includes('DRIVER')
      ? 'Your agency is reviewing your driving licence details. You will be able to take trips once approved.'
      : 'Your agency is awaiting verification by the TTMS team. You will get full access once it is approved.');

  return (
    <AuthShell>
      <div className="text-center">
        <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${rejected ? 'bg-red-50 text-danger' : 'bg-amber-50 text-accent-600'}`}>
          {rejected ? <XCircle className="h-7 w-7" aria-hidden /> : <Clock3 className="h-7 w-7" aria-hidden />}
        </span>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">{rejected ? 'Verification unsuccessful' : 'Verification in progress'}</h1>
        <div className="mt-3">
          <Badge tone={rejected ? 'danger' : 'warning'}>{STATUS_LABELS[verification]}</Badge>
        </div>
        <p className="mt-4 text-sm text-muted">{message}</p>
      </div>

      <dl className="mt-8 divide-y divide-line rounded-2xl border border-line bg-white text-sm">
        <div className="flex justify-between gap-4 px-5 py-3">
          <dt className="text-muted">Account</dt>
          <dd className="text-right font-medium">{user.fullName}</dd>
        </div>
        {user.agency && (
          <div className="flex justify-between gap-4 px-5 py-3">
            <dt className="text-muted">Agency</dt>
            <dd className="text-right font-medium">{user.agency.companyName}</dd>
          </div>
        )}
        {status?.agency.createdAt && (
          <div className="flex justify-between gap-4 px-5 py-3">
            <dt className="text-muted">Submitted</dt>
            <dd className="text-right font-medium">{new Date(status.agency.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</dd>
          </div>
        )}
        {status?.agency.rejectionReason && (
          <div className="px-5 py-3">
            <dt className="text-muted">Reason</dt>
            <dd className="mt-1 font-medium text-danger">{status.agency.rejectionReason}</dd>
          </div>
        )}
      </dl>

      <div className="mt-8 flex justify-center">
        <LogoutButton />
      </div>
    </AuthShell>
  );
}
