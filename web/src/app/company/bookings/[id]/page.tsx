'use client';

import { CheckCircle2, CreditCard, Download, FileText, Handshake, LifeBuoy, Navigation, Pencil, Phone, Repeat, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { MapView } from '@/components/maps/MapView';
import { CancelBookingDialog, EditBookingDialog } from '@/components/portal/BookingActions';
import { BookingStatusBadge, BookingTimeline, PaymentStatusBadge, Rating, TripStatusBadge, VerifiedTag } from '@/components/portal/bits';
import { DemoButton, DemoPanel } from '@/components/portal/DemoPanel';
import { DemoBadge, ErrorBlock, KV, LoadingBlock, PageHeader, SectionTitle, useToast } from '@/components/ui/kit';
import { Alert, Button, Card } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import type { BookingDetail } from '@/lib/company-types';
import { dateTimeIST, dayOnly, duration, inr, kl, km } from '@/lib/format';
import { COMPARTMENTS, PRODUCT_COMPATIBILITY } from '@/lib/status';
import { useApi } from '@/lib/useApi';

function BookingDetailInner() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { data, error, isLoading, mutate } = useApi<{ booking: BookingDetail }>(`/bookings/${id}`);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [simulating, setSimulating] = useState(false);

  if (error) return <ErrorBlock error={error} onRetry={() => mutate()} />;
  if (isLoading || !data) return <LoadingBlock rows={8} />;
  const b = data.booking;
  const activeAllocs = b.allocations.filter((a) => a.status !== 'CANCELLED');
  const confirmed = Boolean(b.acceptedFreight) && b.status !== 'CANCELLED';
  const openForOffers = ['SEARCHING', 'OFFERS_RECEIVED', 'NEGOTIATION'].includes(b.status);

  async function simulateOffers() {
    setSimulating(true);
    try {
      const { data: res } = await api.post(`/demo/bookings/${b.id}/offers`, { count: 3 });
      toast.success(res.message);
      router.push(`/company/bookings/${b.id}/offers`);
    } catch (e) {
      toast.error(e);
    } finally {
      setSimulating(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/company/bookings', label: 'My Bookings' }}
        title={b.bookingCode}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <BookingStatusBadge status={b.status} />
            {b.isDemo && <DemoBadge />}
            <span>Created {dateTimeIST(b.createdAt)}</span>
          </span>
        }
        actions={
          <>
            {b.offersCount > 0 && (
              <Link href={`/company/bookings/${b.id}/offers`} className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-field)] bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-700">
                <Handshake className="h-4 w-4" /> Offers ({b.offersCount})
              </Link>
            )}
            {confirmed && (
              <Link href={`/company/bookings/${b.id}/confirmation`} className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-field)] border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-canvas">
                <CheckCircle2 className="h-4 w-4" /> Confirmation
              </Link>
            )}
            {b.canEdit && (
              <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => router.push(`/company/book?repeat=${b.id}`)}>
              <Repeat className="h-4 w-4" /> Repeat
            </Button>
            <a href={`/api/v1/bookings/${b.id}/summary.pdf`} download className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-field)] border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-canvas">
              <Download className="h-4 w-4" /> Summary PDF
            </a>
            {b.canCancel && (
              <Button variant="ghost" size="sm" className="!text-danger hover:!bg-red-50" onClick={() => setCancelOpen(true)}>
                <XCircle className="h-4 w-4" /> Cancel
              </Button>
            )}
          </>
        }
      />

      {params.get('created') && b.status === 'SEARCHING' && (
        <Alert tone="success" title={`Booking ${b.bookingCode} created`}>
          Your request has been shared with verified transporters that have compatible tankers. You will be notified as offers arrive.
        </Alert>
      )}
      {b.status === 'CANCELLED' && (
        <Alert title="Booking cancelled">
          {b.cancellationReason} · {dateTimeIST(b.cancelledAt)}
        </Alert>
      )}

      {openForOffers && (
        <DemoPanel title="transporter offers">
          <DemoButton onClick={simulateOffers} loading={simulating}>
            Receive demo transporter offers
          </DemoButton>
        </DemoPanel>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card className="!p-0 overflow-hidden">
            <MapView
              className="h-72 rounded-none border-0 sm:h-80"
              pickup={b.pickup ? { lat: b.pickup.latitude, lng: b.pickup.longitude } : null}
              delivery={b.delivery ? { lat: b.delivery.latitude, lng: b.delivery.longitude } : null}
              routes={b.routePolyline ? [{ polyline: b.routePolyline }] : []}
            />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold uppercase text-green-700">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-[10px] text-white">A</span> Pickup
                </p>
                <p className="mt-1 text-sm font-medium text-ink">{b.pickup?.address}</p>
              </div>
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold uppercase text-red-700">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[10px] text-white">B</span> Delivery
                </p>
                <p className="mt-1 text-sm font-medium text-ink">{b.delivery?.address}</p>
              </div>
              <p className="text-xs text-muted sm:col-span-2">
                {km(b.distanceKm)} by road · est. {duration(b.durationMinutes)} · route source: {b.routeProvider}
              </p>
            </div>
          </Card>

          <Card>
            <SectionTitle>Load & schedule</SectionTitle>
            <dl className="divide-y divide-line">
              <KV label="Product">{b.product.name}</KV>
              <KV label="Tankers">
                {b.requirement?.numberOfTankers} × {kl(b.requirement?.tankerCapacityKl)} · {kl(b.requirement?.quantityKl)} total
              </KV>
              <KV label="Tanker type">{b.requirement?.tankerType?.name ?? 'Any suitable type'}</KV>
              <KV label="Compartments">{COMPARTMENTS[b.requirement?.compartmentRequirement ?? 'ANY']}</KV>
              <KV label="Compatibility">{PRODUCT_COMPATIBILITY[b.requirement?.productCompatibility ?? 'ANY_COMPATIBLE']}</KV>
              {b.requirement?.specialRequirements && <KV label="Special requirements">{b.requirement.specialRequirements}</KV>}
              <KV label="Loading">
                {dayOnly(b.loadingDate)} at {b.loadingTime} IST
                <span className="block text-xs font-normal text-muted">
                  {b.loadingContactName} ·{' '}
                  <a href={`tel:+91${b.loadingContactPhone}`} className="text-brand-600">
                    {b.loadingContactPhone}
                  </a>
                  {b.loadingInstructions ? ` · ${b.loadingInstructions}` : ''}
                </span>
              </KV>
              <KV label="Expected delivery">
                {dayOnly(b.expectedDeliveryDate)}
                <span className="block text-xs font-normal text-muted">
                  {b.deliveryContactName} ·{' '}
                  <a href={`tel:+91${b.deliveryContactPhone}`} className="text-brand-600">
                    {b.deliveryContactPhone}
                  </a>
                  {b.deliveryInstructions ? ` · ${b.deliveryInstructions}` : ''}
                </span>
              </KV>
            </dl>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <SectionTitle>Freight</SectionTitle>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Suggested freight (estimate)</dt>
                <dd className="tabular-nums">{inr(b.suggestedFreight)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Your offer</dt>
                <dd className="font-semibold tabular-nums">{inr(b.customerOffer)}</dd>
              </div>
              {!b.acceptedFreight && (
                <div className="flex justify-between">
                  <dt className="text-muted">Best open offer</dt>
                  <dd className="font-semibold tabular-nums">{b.bestOffer ? inr(b.bestOffer) : '—'}</dd>
                </div>
              )}
              {b.acceptedFreight && (
                <div className="flex justify-between rounded-xl bg-green-50 p-3">
                  <dt className="font-semibold text-green-800">Agreed freight (locked)</dt>
                  <dd className="text-lg font-bold tabular-nums text-green-800">{inr(b.acceptedFreight)}</dd>
                </div>
              )}
            </dl>
            {confirmed && (
              <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
                <PaymentStatusBadge status={b.paymentStatus} />
                <Link href={`/company/payments?booking=${b.id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700">
                  <CreditCard className="h-4 w-4" /> Payments
                </Link>
              </div>
            )}
          </Card>

          {(b.requirement?.numberOfTankers ?? 1) > 1 && (
            <Card>
              <SectionTitle>Tanker allocation</SectionTitle>
              <div className="h-2.5 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuenow={b.tankersAllocated} aria-valuemin={0} aria-valuemax={b.requirement?.numberOfTankers ?? 1} aria-label="Tankers allocated">
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${(b.tankersAllocated / (b.requirement?.numberOfTankers ?? 1)) * 100}%` }} />
              </div>
              <p className="mt-2 text-sm text-muted">
                {b.tankersAllocated} of {b.requirement?.numberOfTankers} tankers allocated
                {b.tankersAllocated < (b.requirement?.numberOfTankers ?? 1) && b.status !== 'CANCELLED' ? ' · accept more offers to allocate the rest (partial fulfilment)' : ''}
              </p>
            </Card>
          )}

          {activeAllocs.map((al, idx) => {
            const trips = b.trips.filter((t) => t.allocationId === al.id);
            return (
              <Card key={al.id}>
                <SectionTitle>{activeAllocs.length > 1 ? `Transporter ${idx + 1} · ${al.tankersAllocated} tanker(s)` : 'Transporter & trip'}</SectionTitle>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">{al.transporter.companyName}</p>
                    <p className="text-xs text-muted">
                      {al.transporter.city}, {al.transporter.state}
                    </p>
                    <div className="mt-1 flex items-center gap-3">
                      <Rating value={al.transporter.rating} />
                      <VerifiedTag status={al.transporter.verificationStatus} />
                      {al.transporter.isDemo && <DemoBadge />}
                    </div>
                  </div>
                  <p className="text-right text-sm">
                    <span className="block text-xs text-muted">Agreed freight</span>
                    <span className="font-semibold tabular-nums">{inr(al.agreedFreight)}</span>
                  </p>
                </div>
                {trips.map((trip) => (
                  <dl key={trip.id} className="mt-4 divide-y divide-line border-t border-line">
                    <KV label="Trip">
                      <span className="flex flex-wrap items-center gap-2">
                        {trip.tripCode} <TripStatusBadge status={trip.status} />
                        <Link href={`/company/trips/${trip.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
                          <Navigation className="h-3.5 w-3.5" /> Track
                        </Link>
                      </span>
                    </KV>
                    <KV label="Vehicle">{trip.tanker?.registrationNumber ?? 'To be assigned'}</KV>
                    <KV label="Driver">
                      {trip.driver ? (
                        <span className="flex items-center gap-2">
                          {trip.driver.user.fullName}
                          <a href={`tel:+91${trip.driver.user.phone}`} className="inline-flex items-center gap-1 text-brand-600">
                            <Phone className="h-3.5 w-3.5" /> Call
                          </a>
                        </span>
                      ) : (
                        'To be assigned'
                      )}
                    </KV>
                  </dl>
                ))}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link href={`/company/support/new?booking=${b.id}`} className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-field)] border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-canvas">
                    <LifeBuoy className="h-4 w-4" /> Report issue
                  </Link>
                </div>
              </Card>
            );
          })}

          <Card>
            <SectionTitle>Progress</SectionTitle>
            <BookingTimeline status={b.status} history={b.statusHistory} />
          </Card>

          {(b.invoices.length > 0 || confirmed) && (
            <Card>
              <SectionTitle action={<Link href={`/company/documents?booking=${b.id}`} className="text-sm font-semibold text-brand-600">All documents</Link>}>Documents</SectionTitle>
              <ul className="space-y-2 text-sm">
                {confirmed && (
                  <li className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted" /> Booking confirmation
                    </span>
                    <a href={`/api/v1/bookings/${b.id}/confirmation.pdf`} download className="font-semibold text-brand-600">
                      Download
                    </a>
                  </li>
                )}
                {b.invoices.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted" /> Invoice {inv.invoiceNumber}
                    </span>
                    <a href={`/api/v1/documents/FREIGHT_INVOICE:${inv.id}`} download className="font-semibold text-brand-600">
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <CancelBookingDialog open={cancelOpen} onClose={() => setCancelOpen(false)} booking={b} onDone={() => mutate()} />
      <EditBookingDialog open={editOpen} onClose={() => setEditOpen(false)} booking={b} onDone={() => mutate()} />
    </div>
  );
}

export default function BookingDetailPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={8} />}>
      <BookingDetailInner />
    </Suspense>
  );
}
