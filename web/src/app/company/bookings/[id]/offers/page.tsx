'use client';

import { ArrowUpDown, Handshake } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { BookingStatusBadge } from '@/components/portal/bits';
import { DemoButton, DemoPanel } from '@/components/portal/DemoPanel';
import { OfferCard } from '@/components/portal/OfferCard';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, useToast } from '@/components/ui/kit';
import { Card, SelectField } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import type { BookingDetail, Offer } from '@/lib/company-types';
import { inr, kl, km } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type Sort = 'price' | 'rating' | 'availability' | 'recent';

export default function BookingOffersPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const booking = useApi<{ booking: BookingDetail }>(`/bookings/${id}`);
  const offers = useApi<{ offers: Offer[] }>(`/bookings/${id}/offers`, { refreshInterval: 20_000 });
  const [sort, setSort] = useState<Sort>('price');
  const [simulating, setSimulating] = useState(false);

  if (booking.error) return <ErrorBlock error={booking.error} onRetry={() => booking.mutate()} />;
  if (!booking.data || !offers.data) return <LoadingBlock rows={6} />;
  const b = booking.data.booking;
  const open = ['SEARCHING', 'OFFERS_RECEIVED', 'NEGOTIATION'].includes(b.status);
  const list = [...offers.data.offers];
  const isOpen = (o: Offer) => o.status === 'PENDING' || o.status === 'COUNTERED';
  list.sort((a, c) => {
    if (isOpen(a) !== isOpen(c)) return isOpen(a) ? -1 : 1;
    if (a.status === 'ACCEPTED') return -1;
    if (c.status === 'ACCEPTED') return 1;
    if (sort === 'rating') return c.transporter.rating - a.transporter.rating;
    if (sort === 'availability') return new Date(a.estimatedAvailabilityAt).getTime() - new Date(c.estimatedAvailabilityAt).getTime();
    if (sort === 'recent') return new Date(c.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    return a.currentAmount - c.currentAmount;
  });
  const pending = list.filter((o) => o.status === 'PENDING');
  const bestId = pending.length ? pending.reduce((m, o) => (o.currentAmount < m.currentAmount ? o : m)).id : null;
  const refresh = () => {
    void offers.mutate();
    void booking.mutate();
  };

  async function simulate() {
    setSimulating(true);
    try {
      const { data } = await api.post(`/demo/bookings/${b.id}/offers`, { count: 2 });
      toast.success(data.message);
      refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setSimulating(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: `/company/bookings/${b.id}`, label: b.bookingCode }}
        title="Compare transporter offers"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <BookingStatusBadge status={b.status} />
            {b.pickup?.city ?? '—'} → {b.delivery?.city ?? '—'} · {km(b.distanceKm)} · {b.product.name} · {b.requirement?.numberOfTankers} × {kl(b.requirement?.tankerCapacityKl)}
          </span>
        }
      />

      <Card className="grid gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted">Your offer</p>
          <p className="text-xl font-bold tabular-nums">{inr(b.customerOffer)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Suggested freight</p>
          <p className="text-xl font-bold tabular-nums">{inr(b.suggestedFreight)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Best open offer</p>
          <p className="text-xl font-bold tabular-nums text-green-700">{b.bestOffer ? inr(b.bestOffer) : '—'}</p>
        </div>
        <div>
          <p className="text-xs text-muted">{b.acceptedFreight ? 'Agreed freight' : 'Open offers'}</p>
          <p className="text-xl font-bold tabular-nums">{b.acceptedFreight ? inr(b.acceptedFreight) : b.openOffersCount}</p>
        </div>
      </Card>

      {open && (
        <DemoPanel title="transporter offers">
          <DemoButton onClick={simulate} loading={simulating}>
            Receive more demo offers
          </DemoButton>
        </DemoPanel>
      )}

      {list.length === 0 ? (
        <EmptyState title="No offers yet" icon={<Handshake className="h-6 w-6" />}>
          Transporters with compatible tankers have been notified. Offers will appear here and you will get a notification.
        </EmptyState>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {list.length} offer(s) ·{' '}
              {(b.requirement?.numberOfTankers ?? 1) > 1
                ? `${b.tankersAllocated} of ${b.requirement?.numberOfTankers} tankers allocated — accept one transporter per allocation`
                : 'you can accept only one transporter for this booking'}
            </p>
            <div className="flex items-center gap-2">
              <ArrowUpDown className="h-4 w-4 text-muted" />
              <div className="w-44">
                <SelectField
                  label="Sort offers"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                  options={[
                    { value: 'price', label: 'Lowest price' },
                    { value: 'rating', label: 'Highest rating' },
                    { value: 'availability', label: 'Earliest availability' },
                    { value: 'recent', label: 'Most recent' },
                  ]}
                />
              </div>
            </div>
          </div>
          <div className="space-y-4">
            {list.map((o) => (
              <OfferCard
                key={o.id}
                offer={o}
                customerOffer={b.customerOffer}
                best={o.id === bestId}
                bookingOpen={open}
                tankersNeeded={b.requirement?.numberOfTankers ?? 1}
                tankersAllocated={b.tankersAllocated}
                onChanged={refresh}
                onAccepted={(_, confirmed) => (confirmed ? router.push(`/company/bookings/${b.id}/confirmation`) : refresh())}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
