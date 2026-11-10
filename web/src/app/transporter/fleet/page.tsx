'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { DataTable } from '@/components/transporter/ui';
import { DemoBadge, EmptyState, ErrorBlock, LoadingBlock, PageHeader, Pagination, StatusBadge } from '@/components/ui/kit';
import { Button, TextField } from '@/components/ui/primitives';
import { dayOnly, kl } from '@/lib/format';
import { TANKER_STATUS, VERIFICATION, type Paged } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

type T = { id: string; registrationNumber: string; capacityKl: number; tankerType: { name: string }; compartments: number; products: { name: string }[]; assignedDriver: { name: string } | null; status: string; verificationStatus: string; nextDocumentExpiry: string | null; availableLocation: string | null; isDemo: boolean; currentLocation: { at: string } | null };

export default function Page() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi<Paged<T>>(`/tankers?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  return (
    <>
      <PageHeader title="My fleet" subtitle="A tanker can bid once TankerLink has verified it" actions={<><div className="w-52"><TextField label="Search" placeholder="Registration number" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} /></div><Link href="/transporter/fleet/new"><Button><Plus className="h-4 w-4" aria-hidden /> Add tanker</Button></Link></>} />
      {error ? <ErrorBlock error={error} onRetry={() => void mutate()} /> : !data ? <LoadingBlock /> : data.items.length === 0 ? <EmptyState title="No tankers yet" action={<Link href="/transporter/fleet/new"><Button>Add your first tanker</Button></Link>} /> : (
        <DataTable rows={data.items} rowKey={(t) => t.id} columns={[
          { key: 'id', label: 'Tanker ID', render: (t) => <Link className="font-mono text-xs font-semibold text-brand-600" href={`/transporter/fleet/${t.id}`}>{t.id.slice(0, 8).toUpperCase()}</Link> },
          { key: 'r', label: 'Registration', render: (t) => <>{t.registrationNumber} {t.isDemo && <DemoBadge />}</> }, { key: 'c', label: 'Capacity', render: (t) => kl(t.capacityKl) }, { key: 't', label: 'Type', render: (t) => t.tankerType.name }, { key: 'co', label: 'Compartments', render: (t) => t.compartments },
          { key: 'p', label: 'Products', render: (t) => t.products.map((p) => p.name).join(', ') }, { key: 'd', label: 'Driver', render: (t) => t.assignedDriver?.name ?? '—' }, { key: 's', label: 'Status', render: (t) => <StatusBadge map={TANKER_STATUS} value={t.status} /> },
          { key: 'l', label: 'Location', render: (t) => t.availableLocation ?? '—' }, { key: 'v', label: 'Verification', render: (t) => <StatusBadge map={VERIFICATION} value={t.verificationStatus} /> }, { key: 'e', label: 'Next doc expiry', render: (t) => dayOnly(t.nextDocumentExpiry) },
        ]} />
      )}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </>
  );
}
