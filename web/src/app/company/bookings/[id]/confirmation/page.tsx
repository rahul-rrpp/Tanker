'use client';

import { CheckCircle2, CreditCard, Download, Eye, Navigation } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { BookingTimeline, Rating, VerifiedTag } from '@/components/portal/bits';
import { DemoBadge, ErrorBlock, KV, LoadingBlock, PageHeader, SectionTitle } from '@/components/ui/kit';
import { Alert, Card } from '@/components/ui/primitives';
import type { BookingDetail } from '@/lib/company-types';
import { dateTimeIST, dayOnly, inr, kl } from '@/lib/format';
import { useApi } from '@/lib/useApi';

export default function ConfirmationPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, mutate } = useApi<{ booking: BookingDetail }>(`/bookings/${id}`);
  if (error) return <ErrorBlock error={error} onRetry={() => mutate()} />;
  if (!data) return <LoadingBlock rows={6} />;
  const b = data.booking;
  const alloc = b.allocations.find((a) => a.status !== 'CANCELLED') ?? b.allocations[0];
  const trip = b.trips[0];

  if (!b.acceptedFreight || !alloc) {
    return (
      <div className="space-y-4">
        <PageHeader back={{ href: `/company/bookings/${b.id}`, label: b.bookingCode }} title="Booking confirmation" />
        <Alert tone="info">This booking has not been confirmed with a transporter yet.</Alert>
        <Link href={`/company/bookings/${b.id}/offers`} className="font-semibold text-brand-600">
          View offers →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader back={{ href: `/company/bookings/${b.id}`, label: b.bookingCode }} title="Booking confirmation" />
      <div className="rounded-2xl border border-green-200 bg-gradient-to-br from-green-50 to-white p-6 text-center sm:p-8">
        <CheckCircle2 className="mx-auto h-14 w-14 text-green-600" aria-hidden />
        <h2 className="mt-3 text-2xl font-bold text-ink">Your booking is confirmed</h2>
        <p className="mt-1 text-sm text-muted">
          {b.bookingCode} · confirmed {dateTimeIST(b.confirmedAt)} {b.isDemo || alloc.transporter.isDemo ? <DemoBadge /> : null}
        </p>
        <p className="mt-4 text-sm text-muted">Agreed freight</p>
        <p className="text-4xl font-bold tabular-nums text-ink">{inr(b.acceptedFreight)}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <a href={`/api/v1/bookings/${b.id}/confirmation.pdf`} download className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-field)] bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
            <Download className="h-4 w-4" /> Download confirmation PDF
          </a>
          <a href={`/api/v1/bookings/${b.id}/confirmation.pdf?inline=1`} target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-field)] border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-canvas">
            <Eye className="h-4 w-4" /> Preview
          </a>
          <Link href={`/company/payments?booking=${b.id}`} className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-field)] border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-canvas">
            <CreditCard className="h-4 w-4" /> Pay advance
          </Link>
          {trip && (
            <Link href={`/company/trips/${trip.id}`} className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-field)] border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-canvas">
              <Navigation className="h-4 w-4" /> Track trip
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <SectionTitle>Booking details</SectionTitle>
          <dl className="divide-y divide-line">
            <KV label="Booking ID">{b.bookingCode}</KV>
            {b.allocations
              .filter((a) => a.status !== 'CANCELLED')
              .map((a, i, all) => (
                <KV key={a.id} label={all.length > 1 ? `Transporter ${i + 1}` : 'Transporter company'}>
                  <span className="flex flex-wrap items-center gap-3">
                    {a.transporter.companyName} <Rating value={a.transporter.rating} /> <VerifiedTag status={a.transporter.verificationStatus} />
                    {all.length > 1 && (
                      <span className="text-xs text-muted">
                        {a.tankersAllocated} tanker(s) · {inr(a.agreedFreight)}
                      </span>
                    )}
                  </span>
                </KV>
              ))}
            <KV label="Accepted freight">{inr(b.acceptedFreight)}</KV>
            <KV label="Pickup address">{b.pickup?.address}</KV>
            <KV label="Delivery address">{b.delivery?.address}</KV>
            <KV label="Tanker capacity">
              {b.requirement?.numberOfTankers} × {kl(b.requirement?.tankerCapacityKl)}
            </KV>
            <KV label="Oil type">{b.product.name}</KV>
            <KV label="Loading schedule">
              {dayOnly(b.loadingDate)} at {b.loadingTime} IST
            </KV>
            <KV label="Expected delivery">{dayOnly(b.expectedDeliveryDate)}</KV>
            <KV label="Trips">{b.trips.map((t) => t.tripCode).join(', ') || '—'}</KV>
          </dl>
        </Card>
        <Card>
          <SectionTitle>Progress</SectionTitle>
          <BookingTimeline status={b.status} history={b.statusHistory} />
        </Card>
      </div>
    </div>
  );
}
