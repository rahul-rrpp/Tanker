'use client';

import Link from 'next/link';
import { ListPage } from '@/components/employee/kit';
import { StatusBadge } from '@/components/ui/kit';
import { dateTimeIST, inr } from '@/lib/format';
import { OFFER_STATUS } from '@/lib/status';

type N = { id: string; bookingCode: string; company: string; transporter: string; companyOffer: number; transporterOffer: number; latest: number; expiresAt: string; status: string };

export default function Page() {
  return <ListPage<N> title="Negotiation monitoring" subtitle="View only. Only the company and transporter can accept or change a price." path="/employee/negotiations" tabs={[{ value: '', label: 'Pending' }, { value: 'ACCEPTED', label: 'Accepted' }, { value: 'EXPIRED', label: 'Expired' }]} tabParam="status" rowKey={(o) => o.id} columns={[{ key: 'b', label: 'Booking', render: (o) => <Link className="font-semibold text-brand-600" href={`/employee/negotiations/${o.id}`}>{o.bookingCode}</Link> }, { key: 'c', label: 'Company', render: (o) => o.company }, { key: 't', label: 'Transporter', render: (o) => o.transporter }, { key: 'co', label: 'Company offer', render: (o) => inr(o.companyOffer) }, { key: 'to', label: 'Transporter offer', render: (o) => inr(o.transporterOffer) }, { key: 'l', label: 'Latest', render: (o) => <strong>{inr(o.latest)}</strong> }, { key: 'e', label: 'Expiry', render: (o) => dateTimeIST(o.expiresAt) }, { key: 's', label: 'Status', render: (o) => <StatusBadge map={OFFER_STATUS} value={o.status} /> }]} />;
}
