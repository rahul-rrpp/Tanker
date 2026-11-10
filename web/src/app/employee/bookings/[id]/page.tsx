'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { MapView } from '@/components/maps/MapView';
import { FormModal, Section, useCan } from '@/components/employee/kit';
import { BookingStatusBadge, TripStatusBadge } from '@/components/portal/bits';
import { ErrorBlock, KV, LoadingBlock, PageHeader } from '@/components/ui/kit';
import { Button } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateTimeIST, dayOnly, humanize, inr, km } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type Loc = { type: string; address: string; city: string | null; latitude: string; longitude: string };
type Data = { booking: { id: string; bookingCode: string; status: string; customerOffer: string; acceptedFreight: string | null; distanceKm: string; routePolyline: string | null; loadingDate: string; loadingTime: string; source: string; company: { name: string; contactPersonName: string; contactPhone: string }; product: { name: string }; locations: Loc[]; statusHistory: { id: string; toStatus: string; note: string | null; createdAt: string }[] }; offers: { id: string; status: string; currentAmount: string; transporter: { companyName: string; owner: { phone: string } }; history: { id: string; party: string; action: string; amount: string | null; createdAt: string }[] }[]; trips: { id: string; tripCode: string; status: string }[]; notes: { id: string; note: string; author: string; createdAt: string }[] };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const { data, error, mutate } = useApi<Data>(`/employee/bookings/${id}`);
  const [m, setM] = useState<'note' | 'flag' | 'issue' | null>(null);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  const b = data.booking;
  const p = b.locations.find((l) => l.type === 'PICKUP');
  const d = b.locations.find((l) => l.type === 'DELIVERY');
  const ll = (x?: Loc) => (x ? { lat: Number(x.latitude), lng: Number(x.longitude) } : null);
  const edit = can('bookings.edit');
  return (
    <>
      <PageHeader title={b.bookingCode} subtitle={b.company.name} back={{ href: '/employee/bookings', label: 'Bookings' }} actions={<><BookingStatusBadge status={b.status} />{edit && <><Button size="sm" variant="secondary" onClick={() => setM('note')}>Add note</Button><Button size="sm" variant="secondary" onClick={() => setM('flag')}>Flag delayed</Button><Button size="sm" variant="secondary" onClick={() => setM('issue')}>Raise issue</Button></>}</>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <MapView className="h-72" pickup={ll(p)} delivery={ll(d)} routes={b.routePolyline ? [{ polyline: b.routePolyline }] : []} fitKey={b.id} />
        <Section title="Details"><dl className="divide-y divide-line"><KV label="Pickup">{p?.address}</KV><KV label="Delivery">{d?.address}</KV><KV label="Distance">{km(b.distanceKm)}</KV><KV label="Oil type">{b.product.name}</KV><KV label="Loading">{dayOnly(b.loadingDate)}, {b.loadingTime}</KV><KV label="Customer offer">{inr(b.customerOffer)}</KV><KV label="Accepted freight">{inr(b.acceptedFreight)}</KV><KV label="Company contact">{b.company.contactPersonName} · <a className="text-brand-600" href={`tel:${b.company.contactPhone}`}>{b.company.contactPhone}</a></KV><KV label="Source">{humanize(b.source)}</KV></dl></Section>
        <Section title="Transporter offers">{data.offers.length === 0 ? <p className="text-sm text-muted">No offers.</p> : <ul className="space-y-3 text-sm">{data.offers.map((o) => <li key={o.id}><div className="flex justify-between gap-2"><Link className="font-semibold text-brand-600" href={`/employee/negotiations/${o.id}`}>{o.transporter.companyName}</Link><span>{inr(o.currentAmount)} · {humanize(o.status)}</span></div><a className="text-xs text-brand-600" href={`tel:${o.transporter.owner.phone}`}>{o.transporter.owner.phone}</a></li>)}</ul>}</Section>
        <Section title="Trips and notes"><ul className="mb-3 space-y-1 text-sm">{data.trips.map((t) => <li key={t.id} className="flex justify-between"><Link className="font-semibold text-brand-600" href={`/employee/trips/${t.id}`}>{t.tripCode}</Link><TripStatusBadge status={t.status} /></li>)}</ul><ul className="space-y-1 text-sm">{data.notes.map((n) => <li key={n.id}>{n.note}<span className="block text-xs text-muted">{n.author} · {dateTimeIST(n.createdAt)}</span></li>)}</ul></Section>
      </div>
      <FormModal open={m === 'note'} onClose={() => setM(null)} title="Add note" submit="Save" fields={[{ name: 'note', label: 'Note', type: 'textarea', required: true }]} onSubmit={async (v) => { await api.post(`/employee/bookings/${id}/notes`, v); void mutate(); }} />
      <FormModal open={m === 'flag'} onClose={() => setM(null)} title="Flag as delayed" submit="Flag" fields={[{ name: 'reason', label: 'Reason', type: 'textarea', required: true }]} onSubmit={async (v) => { await api.post(`/employee/bookings/${id}/flag-delayed`, v); void mutate(); }} />
      <FormModal open={m === 'issue'} onClose={() => setM(null)} title="Raise operational issue" submit="Raise" fields={[{ name: 'subject', label: 'Subject', required: true }, { name: 'description', label: 'Description', type: 'textarea', required: true }]} onSubmit={async (v) => { await api.post(`/employee/bookings/${id}/issue`, v); void mutate(); }} />
    </>
  );
}
