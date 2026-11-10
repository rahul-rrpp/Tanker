'use client';

import { AlertTriangle, BadgeIndianRupee, BookCheck, CheckCircle2, Handshake, Inbox, Navigation, Timer, Truck, Users } from 'lucide-react';
import Link from 'next/link';
import { MonthlySpendChart } from '@/components/portal/Charts';
import { TripStatusBadge } from '@/components/portal/bits';
import { DataTable } from '@/components/transporter/ui';
import { DemoBadge, EmptyState, ErrorBlock, LoadingBlock, PageHeader, SectionTitle, StatCard, StatusBadge } from '@/components/ui/kit';
import { Button, Card } from '@/components/ui/primitives';
import { dateTimeIST, dayOnly, inr, kl, km, timeAgo } from '@/lib/format';
import { TANKER_STATUS, useRealtime } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

type Booking = { id: string; bookingCode: string; pickupCity: string; deliveryCity: string; product: string; tankerCapacityKl: number; loadingDate: string; customerOffer: number; distanceKm: number; isDemo: boolean };
type Trip = { id: string; tripCode: string; status: string; etaAt: string | null; pickup?: string; delivery?: string; isSimulated: boolean; tanker: { registrationNumber: string } | null; driver: { user: { fullName: string } } | null };
type Dash = {
  cards: Record<string, number>; newBookings: Booking[]; activeTrips: Trip[]; earnings: { month: string; freight: number }[]; fleet: Record<string, number>;
  notifications: { id: string; title: string; message: string; createdAt: string; link: string | null }[]; alerts: { kind: string; subject: string; detail: string; date: string | null }[]; verificationStatus: string;
};

const QUICK = [['Find Bookings', '/transporter/marketplace'], ['View Offers', '/transporter/offers'], ['Add Tanker', '/transporter/fleet/new'], ['Add Driver', '/transporter/drivers/new'], ['View Active Trips', '/transporter/trips'], ['View Earnings', '/transporter/earnings']];

export default function Page() {
  const { data, error, mutate } = useApi<Dash>('/transporters/dashboard', { refreshInterval: 60_000 });
  useRealtime(['notification', 'offer:changed', 'trip:status'], () => void mutate());
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock rows={8} />;
  const c = data.cards;
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Your fleet, freight and trips at a glance" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <StatCard label="Total tankers" value={c.totalTankers} icon={<Truck className="h-5 w-5" />} href="/transporter/fleet" />
        <StatCard label="Available tankers" value={c.availableTankers} tone="green" icon={<CheckCircle2 className="h-5 w-5" />} href="/transporter/availability" />
        <StatCard label="Booked tankers" value={c.bookedTankers} tone="navy" icon={<BookCheck className="h-5 w-5" />} />
        <StatCard label="Active drivers" value={c.activeDrivers} icon={<Users className="h-5 w-5" />} href="/transporter/drivers" />
        <StatCard label="New booking requests" value={c.newBookingRequests} tone="orange" icon={<Inbox className="h-5 w-5" />} href="/transporter/marketplace" />
        <StatCard label="Pending offers" value={c.pendingOffers} tone="orange" icon={<Handshake className="h-5 w-5" />} href="/transporter/offers" />
        <StatCard label="Accepted offers" value={c.acceptedOffers} tone="green" icon={<Handshake className="h-5 w-5" />} />
        <StatCard label="Confirmed bookings" value={c.confirmedBookings} icon={<BookCheck className="h-5 w-5" />} href="/transporter/bookings" />
        <StatCard label="Active trips" value={c.activeTrips} icon={<Navigation className="h-5 w-5" />} href="/transporter/trips" />
        <StatCard label="Completed trips" value={c.completedTrips} tone="green" icon={<CheckCircle2 className="h-5 w-5" />} href="/transporter/history" />
        <StatCard label="This month's freight" value={inr(c.monthlyFreight)} icon={<BadgeIndianRupee className="h-5 w-5" />} href="/transporter/earnings" />
        <StatCard label="Pending settlements" value={inr(c.pendingSettlements)} tone="orange" icon={<Timer className="h-5 w-5" />} href="/transporter/settlements" />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">{QUICK.map(([l, h]) => <Link key={h} href={h}><Button variant="secondary" size="sm">{l}</Button></Link>)}</div>

      <section className="mt-8">
        <SectionTitle action={<Link className="text-sm font-semibold text-brand-600" href="/transporter/marketplace">View all</Link>}>New booking requests</SectionTitle>
        {data.newBookings.length === 0 ? <EmptyState title="No matching bookings right now">{data.verificationStatus === 'APPROVED' ? 'Verified tankers that are free for the loading dates will bring matching bookings here.' : 'Bookings appear once your account is verified.'}</EmptyState> : (
          <DataTable rows={data.newBookings} rowKey={(b) => b.id} columns={[
            { key: 'id', label: 'Booking ID', render: (b) => <>{b.bookingCode} {b.isDemo && <DemoBadge />}</> },
            { key: 'p', label: 'Pickup', render: (b) => b.pickupCity }, { key: 'd', label: 'Delivery', render: (b) => b.deliveryCity }, { key: 'o', label: 'Oil type', render: (b) => b.product }, { key: 'c', label: 'Capacity', render: (b) => kl(b.tankerCapacityKl) },
            { key: 'l', label: 'Loading', render: (b) => dayOnly(b.loadingDate) }, { key: 'f', label: 'Customer offer', render: (b) => <strong>{inr(b.customerOffer)}</strong> }, { key: 'km', label: 'Distance', render: (b) => km(b.distanceKm) },
            { key: 'a', label: 'Action', render: (b) => <Link className="font-semibold text-brand-600" href={`/transporter/marketplace/${b.id}`}>View</Link> },
          ]} />
        )}
      </section>

      <section className="mt-8">
        <SectionTitle action={<Link className="text-sm font-semibold text-brand-600" href="/transporter/trips">View all</Link>}>Active trips</SectionTitle>
        {data.activeTrips.length === 0 ? <EmptyState title="No active trips" /> : (
          <DataTable rows={data.activeTrips} rowKey={(t) => t.id} columns={[
            { key: 'id', label: 'Trip ID', render: (t) => <Link className="font-semibold text-brand-600" href={`/transporter/trips/${t.id}`}>{t.tripCode}</Link> },
            { key: 't', label: 'Tanker', render: (t) => t.tanker?.registrationNumber ?? '—' }, { key: 'dr', label: 'Driver', render: (t) => t.driver?.user.fullName ?? '—' }, { key: 'p', label: 'Pickup', render: (t) => t.pickup }, { key: 'd', label: 'Delivery', render: (t) => t.delivery },
            { key: 's', label: 'Status', render: (t) => <TripStatusBadge status={t.status} /> }, { key: 'e', label: 'ETA', render: (t) => dateTimeIST(t.etaAt) },
          ]} />
        )}
      </section>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card className="p-5"><SectionTitle>Monthly freight earnings</SectionTitle><MonthlySpendChart data={data.earnings.map((e) => ({ month: e.month, spend: e.freight, trips: 0 }))} /></Card>
        <Card className="p-5">
          <SectionTitle>Fleet availability</SectionTitle>
          {Object.keys(data.fleet).length === 0 ? <p className="text-sm text-muted">No tankers yet.</p> : <ul className="space-y-2">{Object.entries(data.fleet).map(([s, n]) => <li key={s} className="flex items-center justify-between text-sm"><StatusBadge map={TANKER_STATUS} value={s} /><span className="font-semibold tabular-nums">{n}</span></li>)}</ul>}
        </Card>
        <Card className="p-5">
          <SectionTitle action={<Link className="text-sm font-semibold text-brand-600" href="/transporter/notifications">All</Link>}>Recent notifications</SectionTitle>
          {data.notifications.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : <ul className="divide-y divide-line">{data.notifications.map((n) => <li key={n.id} className="py-2.5 text-sm"><Link href={n.link ?? '/transporter/notifications'} className="font-medium text-ink hover:text-brand-600">{n.title}</Link><p className="text-xs text-muted">{timeAgo(n.createdAt)} · {n.message}</p></li>)}</ul>}
        </Card>
        <Card className="p-5">
          <SectionTitle>Driver and document alerts</SectionTitle>
          {data.alerts.length === 0 ? <p className="text-sm text-muted">All documents are in date.</p> : <ul className="space-y-2">{data.alerts.map((a, i) => <li key={i} className="flex items-start gap-2 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" aria-hidden /><span><strong>{a.subject}</strong>: {a.detail}{a.date ? ` (${dayOnly(a.date)})` : ''}</span></li>)}</ul>}
        </Card>
      </div>
    </>
  );
}
