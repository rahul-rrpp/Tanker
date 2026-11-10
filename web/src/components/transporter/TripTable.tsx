'use client';

import Link from 'next/link';
import { useState } from 'react';
import { TripStatusBadge } from '@/components/portal/bits';
import { DataTable } from '@/components/transporter/ui';
import { DemoBadge, EmptyState, ErrorBlock, LoadingBlock, PageHeader, Pagination } from '@/components/ui/kit';
import { Badge, TextField } from '@/components/ui/primitives';
import { dateTimeIST } from '@/lib/format';
import { useRealtime, type Paged } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

export type TripRow = { id: string; tripCode: string; status: string; exception: string | null; etaAt: string | null; completedAt: string | null; deliveredAt: string | null; lastGpsAt: string | null; isDemo: boolean; bookingCode: string; company: string; pickup: string; delivery: string; tanker: { registrationNumber: string } | null; driver: { name: string } | null };

export function TripTable({ scope, title, subtitle }: { scope: 'active' | 'history'; title: string; subtitle: string }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi<Paged<TripRow>>(`/transporters/me/trips?scope=${scope}&page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`, { refreshInterval: 30_000 });
  useRealtime(['trip:status', 'trip:alert'], () => void mutate());
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={<div className="w-56"><TextField label="Search" placeholder="Trip, booking or vehicle" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} /></div>} />
      {error ? <ErrorBlock error={error} onRetry={() => void mutate()} /> : !data ? <LoadingBlock /> : data.items.length === 0 ? <EmptyState title="No trips here" /> : (
        <DataTable rows={data.items} rowKey={(t) => t.id} columns={[
          { key: 'id', label: 'Trip', render: (t) => <Link className="font-semibold text-brand-600" href={`/transporter/trips/${t.id}`}>{t.tripCode}</Link> },
          { key: 'b', label: 'Booking', render: (t) => <>{t.bookingCode} {t.isDemo && <DemoBadge />}</> }, { key: 'c', label: 'Company', render: (t) => t.company }, { key: 'r', label: 'Route', render: (t) => `${t.pickup} → ${t.delivery}` },
          { key: 't', label: 'Tanker', render: (t) => t.tanker?.registrationNumber ?? '—' }, { key: 'd', label: 'Driver', render: (t) => t.driver?.name ?? '—' },
          { key: 's', label: 'Status', render: (t) => <span className="flex flex-wrap gap-1"><TripStatusBadge status={t.status} />{t.exception && <Badge tone="danger">{t.exception.toLowerCase()}</Badge>}</span> },
          scope === 'active' ? { key: 'e', label: 'ETA', render: (t) => dateTimeIST(t.etaAt) } : { key: 'e', label: 'Completed', render: (t) => dateTimeIST(t.completedAt ?? t.deliveredAt) },
        ]} />
      )}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </>
  );
}
