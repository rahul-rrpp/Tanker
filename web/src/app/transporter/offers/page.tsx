'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DataTable } from '@/components/transporter/ui';
import { DemoBadge, EmptyState, ErrorBlock, LoadingBlock, PageHeader, Pagination, StatusBadge, Tabs } from '@/components/ui/kit';
import { TextField } from '@/components/ui/primitives';
import { dateTimeIST, inr } from '@/lib/format';
import { MY_OFFER_STATUS, useRealtime, type Paged } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

const TABS = [['all', 'All offers'], ['pending', 'Pending'], ['counter', 'Counter-offers received'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['expired', 'Expired'], ['withdrawn', 'Withdrawn']] as const;
type Tab = (typeof TABS)[number][0];
type Offer = { id: string; status: string; bookingId: string; bookingCode: string; company: string; pickup: string; delivery: string; customerOffer: number; myLatestOffer: number | null; expiresAt: string; isDemo: boolean };

export default function Page() {
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi<Paged<Offer> & { counts: Record<Tab, number> }>(`/transporters/me/offers?tab=${tab}&page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`, { refreshInterval: 30_000 });
  useRealtime(['notification', 'offer:changed'], () => void mutate());
  return (
    <>
      <PageHeader title="My offers & negotiations" subtitle="Your private negotiations with each company" actions={<div className="w-56"><TextField label="Search" placeholder="Booking ID" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} /></div>} />
      <Tabs tabs={TABS.map(([value, label]) => ({ value, label }))} value={tab} onChange={(v) => { setTab(v); setPage(1); }} counts={data?.counts} />
      <div className="mt-4">
        {error ? <ErrorBlock error={error} onRetry={() => void mutate()} /> : !data ? <LoadingBlock /> : data.items.length === 0 ? <EmptyState title="No offers here" action={<Link className="font-semibold text-brand-600" href="/transporter/marketplace">Find bookings</Link>} /> : (
          <DataTable rows={data.items} rowKey={(o) => o.id} columns={[
            { key: 'id', label: 'Offer', render: (o) => <Link className="font-mono text-xs font-semibold text-brand-600" href={`/transporter/offers/${o.id}`}>{o.id.slice(0, 8).toUpperCase()}</Link> },
            { key: 'b', label: 'Booking ID', render: (o) => <>{o.bookingCode} {o.isDemo && <DemoBadge />}</> },
            { key: 'c', label: 'Company', render: (o) => o.company }, { key: 'p', label: 'Pickup', render: (o) => o.pickup }, { key: 'd', label: 'Delivery', render: (o) => o.delivery },
            { key: 'co', label: 'Customer offer', render: (o) => inr(o.customerOffer) }, { key: 'my', label: 'My latest', render: (o) => inr(o.myLatestOffer) },
            { key: 's', label: 'Status', render: (o) => <StatusBadge map={MY_OFFER_STATUS} value={o.status} /> }, { key: 'e', label: 'Expiry', render: (o) => (['PENDING', 'COUNTERED'].includes(o.status) ? dateTimeIST(o.expiresAt) : '—') },
            { key: 'a', label: 'Action', render: (o) => <Link className="font-semibold text-brand-600" href={`/transporter/offers/${o.id}`}>{o.status === 'COUNTERED' ? 'Respond' : 'View'}</Link> },
          ]} />
        )}
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      </div>
    </>
  );
}
