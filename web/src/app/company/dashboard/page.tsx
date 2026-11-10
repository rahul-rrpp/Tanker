'use client';

import { BookOpenCheck, CheckCircle2, CircleCheckBig, Clock, Handshake, IndianRupee, Navigation, PlusCircle, Repeat, Truck, XCircle } from 'lucide-react';
import Link from 'next/link';
import { MonthlySpendChart, StatusOverviewChart } from '@/components/portal/Charts';
import { BookingStatusBadge } from '@/components/portal/bits';
import { DemoBadge, EmptyState, ErrorBlock, LoadingBlock, PageHeader, SectionTitle, StatCard } from '@/components/ui/kit';
import { Card } from '@/components/ui/primitives';
import type { NotificationItem } from '@/lib/company-types';
import { dateIST, inr, kl, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/useApi';

interface Dashboard {
  summary: {
    totalBookings: number;
    pendingBookings: number;
    offersReceived: number;
    confirmedBookings: number;
    activeTrips: number;
    completedTrips: number;
    cancelledBookings: number;
    totalTransportExpense: number;
    averageFreightPerTrip: number;
    confirmedTrips: number;
  };
  recentBookings: {
    id: string;
    bookingCode: string;
    status: string;
    createdAt: string;
    isDemo: boolean;
    product: string;
    pickup: string;
    delivery: string;
    tankerCapacityKl: number | null;
    numberOfTankers: number | null;
    customerOffer: number;
    acceptedFreight: number | null;
  }[];
  statusOverview: { key: string; label: string; value: number }[];
  recentNotifications: NotificationItem[];
  frequentRoutes: { route: string; bookings: number; lastBookingId: string; lastAt: string; averageFreight: number | null }[];
  lastBookingId: string | null;
  analytics: { monthly: { month: string; spend: number; trips: number; bookings: number }[] };
}

export default function DashboardPage() {
  const { data, error, isLoading, mutate } = useApi<Dashboard>('/companies/dashboard');
  const { data: activeTrips } = useApi<{ trips: { id: string }[] }>('/trips?scope=active');

  const quick = [
    { href: '/company/book', label: 'Book New Tanker', icon: PlusCircle, primary: true },
    { href: '/company/offers', label: 'View Pending Offers', icon: Handshake, badge: data?.summary.offersReceived },
    { href: activeTrips?.trips.length === 1 ? `/company/trips/${activeTrips.trips[0].id}` : '/company/tracking', label: 'Track Active Trip', icon: Navigation },
    data?.lastBookingId
      ? { href: `/company/book?repeat=${data.lastBookingId}`, label: 'Repeat Previous Booking', icon: Repeat }
      : { href: '/company/bookings', label: 'Repeat Previous Booking', icon: Repeat },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle="Your bookings, offers, trips and freight spend at a glance." />
      {error ? (
        <ErrorBlock error={error} onRetry={() => mutate()} />
      ) : isLoading || !data ? (
        <LoadingBlock rows={6} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            <StatCard label="Total bookings" value={data.summary.totalBookings} icon={<BookOpenCheck className="h-5 w-5" />} href="/company/bookings" />
            <StatCard label="Pending bookings" value={data.summary.pendingBookings} icon={<Clock className="h-5 w-5" />} tone="orange" hint="Searching / negotiating" href="/company/bookings?tab=searching" />
            <StatCard label="Offers received" value={data.summary.offersReceived} icon={<Handshake className="h-5 w-5" />} tone="orange" hint="Awaiting your decision" href="/company/offers" />
            <StatCard label="Confirmed bookings" value={data.summary.confirmedBookings} icon={<CircleCheckBig className="h-5 w-5" />} hint="Before transit" href="/company/bookings?tab=confirmed" />
            <StatCard label="Active trips" value={data.summary.activeTrips} icon={<Truck className="h-5 w-5" />} href="/company/trips" />
            <StatCard label="Completed trips" value={data.summary.completedTrips} icon={<CheckCircle2 className="h-5 w-5" />} tone="green" href="/company/bookings?tab=completed" />
            <StatCard label="Cancelled bookings" value={data.summary.cancelledBookings} icon={<XCircle className="h-5 w-5" />} tone="red" href="/company/bookings?tab=cancelled" />
            <StatCard label="Total freight expenditure" value={inr(data.summary.totalTransportExpense)} icon={<IndianRupee className="h-5 w-5" />} tone="navy" hint={`Avg ${inr(data.summary.averageFreightPerTrip)} per booking`} href="/company/reports?report=monthly-expenditure" />
          </div>

          <Card>
            <SectionTitle>Quick actions</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {quick.map(({ href, label, icon: Icon, primary, badge }) => (
                <Link
                  key={label}
                  href={href}
                  className={
                    primary
                      ? 'flex items-center gap-3 rounded-xl bg-brand-600 px-4 py-3.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700'
                      : 'flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3.5 text-sm font-semibold text-ink hover:border-brand-300 hover:bg-brand-50'
                  }
                >
                  <Icon className="h-5 w-5" aria-hidden />
                  <span className="flex-1">{label}</span>
                  {badge ? <span className="rounded-full bg-orange-500 px-2 text-xs font-bold text-white">{badge}</span> : null}
                </Link>
              ))}
            </div>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card className="!p-0">
              <div className="p-5 pb-0 sm:p-6 sm:pb-0">
                <SectionTitle action={<Link href="/company/bookings" className="text-sm font-semibold text-brand-600 hover:text-brand-700">View all</Link>}>Recent bookings</SectionTitle>
              </div>
              {data.recentBookings.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No bookings yet" action={<Link href="/company/book" className="font-semibold text-brand-600">Book your first tanker</Link>}>
                    Create a booking and verified transporters will send you offers.
                  </EmptyState>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                        <th className="px-5 py-3 font-medium sm:px-6">Booking ID</th>
                        <th className="px-3 py-3 font-medium">Date</th>
                        <th className="px-3 py-3 font-medium">Pickup → Delivery</th>
                        <th className="px-3 py-3 font-medium">Capacity</th>
                        <th className="px-3 py-3 text-right font-medium">Customer offer</th>
                        <th className="px-3 py-3 text-right font-medium">Accepted price</th>
                        <th className="px-5 py-3 font-medium sm:px-6">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentBookings.map((b) => (
                        <tr key={b.id} className="border-b border-line last:border-0 hover:bg-canvas/60">
                          <td className="px-5 py-3 sm:px-6">
                            <Link href={`/company/bookings/${b.id}`} className="font-semibold text-brand-700 hover:underline">
                              {b.bookingCode}
                            </Link>
                            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                              {b.product} {b.isDemo && <DemoBadge />}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-muted">{dateIST(b.createdAt)}</td>
                          <td className="px-3 py-3">
                            {b.pickup} <span className="text-muted">→</span> {b.delivery}
                          </td>
                          <td className="px-3 py-3">
                            {kl(b.tankerCapacityKl)}
                            {b.numberOfTankers && b.numberOfTankers > 1 ? ` × ${b.numberOfTankers}` : ''}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">{inr(b.customerOffer)}</td>
                          <td className="px-3 py-3 text-right font-semibold tabular-nums">{b.acceptedFreight ? inr(b.acceptedFreight) : '—'}</td>
                          <td className="px-5 py-3 sm:px-6">
                            <BookingStatusBadge status={b.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card>
              <SectionTitle>Booking status overview</SectionTitle>
              <StatusOverviewChart data={data.statusOverview} />
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Card>
              <SectionTitle action={<Link href="/company/reports?report=monthly-expenditure" className="text-sm font-semibold text-brand-600">Full report</Link>}>Monthly freight expenditure</SectionTitle>
              <MonthlySpendChart data={data.analytics.monthly} />
            </Card>
            <Card>
              <SectionTitle action={<Link href="/company/notifications" className="text-sm font-semibold text-brand-600 hover:text-brand-700">All</Link>}>Recent notifications</SectionTitle>
              {data.recentNotifications.length === 0 ? (
                <p className="text-sm text-muted">Booking and trip updates will appear here.</p>
              ) : (
                <ul className="space-y-3">
                  {data.recentNotifications.map((n) => (
                    <li key={n.id} className="flex gap-3">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-slate-300' : 'bg-orange-500'}`} aria-hidden />
                      <div className="min-w-0 text-sm">
                        {n.link ? (
                          <Link href={n.link} className={`hover:text-brand-700 ${n.readAt ? 'text-ink' : 'font-semibold text-ink'}`}>
                            {n.title}
                          </Link>
                        ) : (
                          <p className="font-medium text-ink">{n.title}</p>
                        )}
                        <p className="truncate text-xs text-muted">
                          {n.message} · {timeAgo(n.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card className="!p-0">
            <div className="p-5 pb-0 sm:p-6 sm:pb-0">
              <SectionTitle action={<Link href="/company/reports?report=route-wise" className="text-sm font-semibold text-brand-600">Route report</Link>}>Frequently used routes</SectionTitle>
            </div>
            {data.frequentRoutes.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted">Your most-used pickup and delivery routes will appear here.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-6 py-3 font-medium">Route</th>
                      <th className="px-3 py-3 text-right font-medium">Bookings</th>
                      <th className="px-3 py-3 text-right font-medium">Avg agreed freight</th>
                      <th className="px-3 py-3 font-medium">Last booked</th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.frequentRoutes.map((r) => (
                      <tr key={r.route} className="border-b border-line last:border-0">
                        <td className="px-6 py-3 font-medium text-ink">{r.route}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{r.bookings}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{r.averageFreight ? inr(r.averageFreight) : '—'}</td>
                        <td className="px-3 py-3 text-muted">{dateIST(r.lastAt)}</td>
                        <td className="px-6 py-3 text-right">
                          <Link href={`/company/book?repeat=${r.lastBookingId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">
                            <Repeat className="h-3.5 w-3.5" /> Book again
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
