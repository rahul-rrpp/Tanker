'use client';

import Link from 'next/link';
import { ListPage } from '@/components/employee/kit';
import { TripStatusBadge } from '@/components/portal/bits';
import { Badge } from '@/components/ui/primitives';
import { dayOnly, humanize } from '@/lib/format';

type T = { id: string; tripCode: string; bookingCode: string; company: string; transporter: string; tanker: string | null; driver: string | null; pickup: string; delivery: string; loadingDate: string; expectedDeliveryDate: string; status: string; alerts: string[] };

export default function Page() {
  return <ListPage<T> title="Trip operations" path="/employee/trips" tabs={[{ value: '', label: 'Active' }, { value: 'all', label: 'All' }]} tabParam="scope" rowKey={(t) => t.id} columns={[{ key: 'i', label: 'Trip', render: (t) => <Link className="font-semibold text-brand-600" href={`/employee/trips/${t.id}`}>{t.tripCode}</Link> }, { key: 'b', label: 'Booking', render: (t) => t.bookingCode }, { key: 'c', label: 'Company', render: (t) => t.company }, { key: 'tr', label: 'Transporter', render: (t) => t.transporter }, { key: 'v', label: 'Tanker / driver', render: (t) => `${t.tanker ?? '—'} / ${t.driver ?? '—'}` }, { key: 'r', label: 'Route', render: (t) => `${t.pickup} → ${t.delivery}` }, { key: 'l', label: 'Loading', render: (t) => dayOnly(t.loadingDate) }, { key: 'e', label: 'Expected', render: (t) => dayOnly(t.expectedDeliveryDate) }, { key: 's', label: 'Status', render: (t) => <TripStatusBadge status={t.status} /> }, { key: 'a', label: 'Alerts', render: (t) => <span className="flex flex-wrap gap-1">{t.alerts.map((a) => <Badge key={a} tone="danger">{humanize(a)}</Badge>)}</span> }]} />;
}
