'use client';

import Link from 'next/link';
import { ListPage, useCan } from '@/components/employee/kit';
import { BookingStatusBadge } from '@/components/portal/bits';
import { DemoBadge } from '@/components/ui/kit';
import { dayOnly, inr, kl } from '@/lib/format';

type B = { id: string; bookingCode: string; company: string; pickup: string; delivery: string; product: string; tankerCapacityKl: number; customerOffer: number; transporterOffer: number | null; acceptedFreight: number | null; status: string; loadingDate: string; isDemo: boolean };

export default function Page() {
  const can = useCan();
  return <ListPage<B> title="Booking management" path="/employee/bookings" exportable={can('bookings.export')} tabs={[{ value: '', label: 'All' }, { value: '1', label: 'Unallocated' }]} tabParam="unallocated" rowKey={(b) => b.id} columns={[{ key: 'c', label: 'Booking', render: (b) => <><Link className="font-semibold text-brand-600" href={`/employee/bookings/${b.id}`}>{b.bookingCode}</Link> {b.isDemo && <DemoBadge />}</> }, { key: 'co', label: 'Company', render: (b) => b.company }, { key: 'r', label: 'Route', render: (b) => `${b.pickup} → ${b.delivery}` }, { key: 'p', label: 'Oil type', render: (b) => b.product }, { key: 'k', label: 'Capacity', render: (b) => kl(b.tankerCapacityKl) }, { key: 'o', label: 'Customer offer', render: (b) => inr(b.customerOffer) }, { key: 't', label: 'Lowest open offer', render: (b) => inr(b.transporterOffer) }, { key: 'a', label: 'Accepted', render: (b) => inr(b.acceptedFreight) }, { key: 's', label: 'Status', render: (b) => <BookingStatusBadge status={b.status} /> }, { key: 'l', label: 'Loading', render: (b) => dayOnly(b.loadingDate) }]} />;
}
