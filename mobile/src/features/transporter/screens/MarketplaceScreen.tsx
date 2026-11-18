import { useRouter } from 'expo-router';
import { Banner, ListCard } from '@/components/ui';
import { Page } from '@/components/layout';
import { QueryState } from '@/components/common';
import { dateTime, day, inr, km } from '@/utils/format';
import { useQuery } from '@/hooks';
import type { MarketCard } from '../types';
import { ENDPOINTS } from '@/services/api';
import { ROUTES } from '@/navigation/routes';

export default function MarketplaceScreen() {
  const router = useRouter();
  const q = useQuery<{ items: MarketCard[]; total: number; canBid: boolean }>(ENDPOINTS.transporter.marketplace, { pollMs: 60_000 });
  return (
    <Page title="Available bookings" subtitle="Only bookings your verified, free tankers can serve" refreshing={q.refreshing} onRefresh={q.refresh}>
      {q.data && !q.data.canBid ? <Banner tone="info">Bidding opens once your account is verified.</Banner> : null}
      <QueryState loading={q.loading} error={q.error} empty={q.data?.items.length === 0} emptyText="No matching bookings right now" emptyIcon="search-outline" onRetry={q.reload} />
      {q.data?.items.map((b) => (
        <ListCard
          key={b.id}
          code={`${b.bookingCode}${b.isDemo ? ' · DEMO' : ''}`}
          from={b.pickupCity}
          to={b.deliveryCity}
          amount={inr(b.customerOffer)}
          amountLabel="Customer offer"
          meta={[
            `${b.product} · ${b.tankerCapacityKl} KL · ${km(b.distanceKm)}`,
            `Loading ${day(b.loadingDate)} ${b.loadingTime} · ${b.remainingTankers} of ${b.numberOfTankers} tanker(s) needed · you have ${b.availableTankers} free`,
          ]}
          note={`Offers close ${dateTime(b.offerExpiresAt)}`}
          onPress={() => router.push(ROUTES.transporter.marketBooking(b.id))}
        />
      ))}
    </Page>
  );
}
