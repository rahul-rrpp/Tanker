'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { DataTable } from '@/components/transporter/ui';
import { DemoBadge, EmptyState, ErrorBlock, LoadingBlock, PageHeader, Pagination, StatusBadge } from '@/components/ui/kit';
import { Button, TextField } from '@/components/ui/primitives';
import { dayOnly, timeAgo } from '@/lib/format';
import { ACCOUNT_STATUS, VERIFICATION, type Paged } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

type D = { id: string; fullName: string; phone: string; licenceNumber: string; licenceType: string; licenceExpiry: string; verificationStatus: string; accountStatus: string; lastLoginAt: string | null; assignedTanker: { registrationNumber: string } | null; tripCount: number; isDemo: boolean };

export default function Page() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi<Paged<D>>(`/transporters/me/drivers?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  return (
    <>
      <PageHeader title="Driver management" subtitle="Drivers sign in with their own mobile number. Your password is never shared." actions={<><div className="w-52"><TextField label="Search" placeholder="Name or mobile" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} /></div><Link href="/transporter/drivers/new"><Button><Plus className="h-4 w-4" aria-hidden /> Add driver</Button></Link></>} />
      {error ? <ErrorBlock error={error} onRetry={() => void mutate()} /> : !data ? <LoadingBlock /> : data.items.length === 0 ? <EmptyState title="No drivers yet" action={<Link href="/transporter/drivers/new"><Button>Add your first driver</Button></Link>} /> : (
        <DataTable rows={data.items} rowKey={(d) => d.id} columns={[
          { key: 'n', label: 'Driver', render: (d) => <Link className="font-semibold text-brand-600" href={`/transporter/drivers/${d.id}`}>{d.fullName}</Link> }, { key: 'p', label: 'Mobile', render: (d) => <>{d.phone} {d.isDemo && <DemoBadge />}</> }, { key: 'l', label: 'Licence', render: (d) => `${d.licenceNumber} (${d.licenceType})` }, { key: 'e', label: 'Licence expiry', render: (d) => dayOnly(d.licenceExpiry) },
          { key: 't', label: 'Tanker', render: (d) => d.assignedTanker?.registrationNumber ?? '—' }, { key: 'trips', label: 'Trips', render: (d) => d.tripCount }, { key: 'v', label: 'Verification', render: (d) => <StatusBadge map={VERIFICATION} value={d.verificationStatus} /> }, { key: 'a', label: 'Login', render: (d) => <StatusBadge map={ACCOUNT_STATUS} value={d.accountStatus} /> }, { key: 'll', label: 'Last sign-in', render: (d) => timeAgo(d.lastLoginAt) },
        ]} />
      )}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </>
  );
}
