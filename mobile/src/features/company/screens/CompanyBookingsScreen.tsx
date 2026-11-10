import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Card, Chips, Pill } from '@/components/ui';
import { Page } from '@/components/layout';
import { QueryState } from '@/components/common';
import { toneFor } from '@/utils/status';
import { city, day, humanize, inr } from '@/utils/format';
import { colors } from '@/theme';
import { useQuery } from '@/hooks';
import { ENDPOINTS } from '@/services/api';
import { ROUTES } from '@/navigation/routes';

type B = { id: string; bookingCode: string; status: string; customerOffer: string; acceptedFreight: string | null; loadingDate: string; locations: { type: string; city: string | null }[]; product: { name: string }; offers: unknown[]; isDemo: boolean };
const TABS = [['all', 'All'], ['searching', 'Searching'], ['offers', 'Offers'], ['negotiation', 'Negotiation'], ['confirmed', 'Confirmed'], ['in_transit', 'In transit'], ['completed', 'Completed'], ['cancelled', 'Cancelled']] as const;
type Tab = (typeof TABS)[number][0];

export default function CompanyBookingsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('all');
  const q = useQuery<{ items: B[]; total: number }>(ENDPOINTS.company.bookings(tab));
  return (
    <Page title="My bookings" subtitle={q.data ? `${q.data.total} total` : undefined} refreshing={q.refreshing} onRefresh={q.refresh}>
      <Chips value={tab} options={TABS.map(([value, label]) => ({ value, label }))} onChange={setTab} />
      <QueryState loading={q.loading} error={q.error} empty={q.data?.items.length === 0} emptyText="No bookings here" onRetry={q.reload} />
      {q.data?.items.map((b) => (
        <Card key={b.id} onPress={() => router.push(ROUTES.company.booking(b.id))}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>{city(b.locations, 'PICKUP')} → {city(b.locations, 'DELIVERY')}{b.isDemo ? '  (demo)' : ''}</Text>
          <Text style={{ color: colors.muted }}>{b.bookingCode} · {b.product.name} · loading {day(b.loadingDate)}</Text>
          <Text style={{ color: colors.ink }}>{b.acceptedFreight ? `Agreed ${inr(b.acceptedFreight)}` : `Your offer ${inr(b.customerOffer)}`}{b.offers.length ? ` · ${b.offers.length} open offer(s)` : ''}</Text>
          <Pill label={humanize(b.status)} tone={toneFor(b.status)} />
        </Card>
      ))}
    </Page>
  );
}
