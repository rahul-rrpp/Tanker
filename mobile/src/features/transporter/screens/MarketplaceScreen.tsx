import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { Card, Banner } from '@/components/ui';
import { Page } from '@/components/layout';
import { QueryState } from '@/components/common';
import { dateTime, day, inr, km } from '@/utils/format';
import { colors } from '@/theme';
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
      <QueryState loading={q.loading} error={q.error} empty={q.data?.items.length === 0} emptyText="No matching bookings right now" onRetry={q.reload} />
      {q.data?.items.map((b) => (
        <Card key={b.id} onPress={() => router.push(ROUTES.transporter.marketBooking(b.id))}>
          <Text style={{ fontWeight: '700', fontSize: 16, color: colors.ink }}>{b.pickupCity} → {b.deliveryCity}{b.isDemo ? '  (demo)' : ''}</Text>
          <Text style={{ color: colors.brand700, fontWeight: '800', fontSize: 18 }}>{inr(b.customerOffer)}</Text>
          <Text style={{ color: colors.muted }}>{b.bookingCode} · {b.product} · {b.tankerCapacityKl} KL · {km(b.distanceKm)}</Text>
          <Text style={{ color: colors.ink }}>Loading {day(b.loadingDate)} {b.loadingTime} · {b.remainingTankers} of {b.numberOfTankers} tanker(s) needed · you have {b.availableTankers} free</Text>
          <Text style={{ color: colors.warning, fontSize: 12 }}>Offers close {dateTime(b.offerExpiresAt)}</Text>
        </Card>
      ))}
    </Page>
  );
}
