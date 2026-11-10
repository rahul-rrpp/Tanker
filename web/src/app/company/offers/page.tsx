'use client';

import { Handshake } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BookingStatusBadge } from '@/components/portal/bits';
import { OfferCard } from '@/components/portal/OfferCard';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, Tabs } from '@/components/ui/kit';
import type { Offer } from '@/lib/company-types';
import { inr } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type Filter = 'open' | 'closed' | 'all';

export default function OffersPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('open');
  const { data, error, isLoading, mutate } = useApi<{ offers: Offer[] }>(`/offers?status=${filter}`, { refreshInterval: 20_000 });

  // Group offers by booking so the company compares like with like.
  const groups = new Map<string, Offer[]>();
  for (const o of data?.offers ?? []) groups.set(o.bookingId, [...(groups.get(o.bookingId) ?? []), o]);

  return (
    <div className="space-y-5">
      <PageHeader title="Transporter Offers" subtitle="Offers and counter-offers across all your bookings, grouped by booking." />
      <Tabs
        tabs={[
          { value: 'open', label: 'Needs attention' },
          { value: 'closed', label: 'Closed' },
          { value: 'all', label: 'All offers' },
        ]}
        value={filter}
        onChange={setFilter}
      />
      {error ? (
        <ErrorBlock error={error} onRetry={() => mutate()} />
      ) : isLoading || !data ? (
        <LoadingBlock rows={5} />
      ) : groups.size === 0 ? (
        <EmptyState title={filter === 'open' ? 'No offers awaiting action' : 'No offers'} icon={<Handshake className="h-6 w-6" />} action={<Link href="/company/book" className="font-semibold text-brand-600">Book a tanker</Link>}>
          When transporters respond to your bookings, their offers appear here.
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {[...groups.entries()].map(([bookingId, offers]) => {
            const bk = offers[0].booking!;
            const open = ['SEARCHING', 'OFFERS_RECEIVED', 'NEGOTIATION'].includes(bk.status);
            const pending = offers.filter((o) => o.status === 'PENDING');
            const bestId = pending.length ? pending.reduce((m, o) => (o.currentAmount < m.currentAmount ? o : m)).id : null;
            const pickup = bk.locations?.find((l) => l.type === 'PICKUP');
            const drop = bk.locations?.find((l) => l.type === 'DELIVERY');
            return (
              <section key={bookingId}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/company/bookings/${bookingId}/offers`} className="text-lg font-semibold text-brand-700 hover:underline">
                      {bk.bookingCode}
                    </Link>
                    <BookingStatusBadge status={bk.status} />
                    <span className="text-sm text-muted">
                      {pickup?.city} → {drop?.city} · {bk.product?.name} · your offer {inr(bk.customerOffer)}
                    </span>
                  </div>
                  <Link href={`/company/bookings/${bookingId}`} className="text-sm font-semibold text-brand-600">
                    View booking
                  </Link>
                </div>
                <div className="space-y-4">
                  {offers.map((o) => (
                    <OfferCard
                      key={o.id}
                      offer={o}
                      customerOffer={bk.customerOffer}
                      best={o.id === bestId}
                      bookingOpen={open}
                      tankersNeeded={bk.requirement?.numberOfTankers ?? 1}
                      tankersAllocated={(bk.allocations ?? []).reduce((s, a) => s + a.tankersAllocated, 0)}
                      onChanged={() => mutate()}
                      onAccepted={(bid, confirmed) => (confirmed ? router.push(`/company/bookings/${bid}/confirmation`) : mutate())}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
