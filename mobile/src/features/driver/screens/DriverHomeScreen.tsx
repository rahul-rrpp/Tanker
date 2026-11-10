import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { Card, Pill, Row, Banner, Button } from '@/components/ui';
import { Page } from '@/components/layout';
import { QueryState } from '@/components/common';
import { toneFor } from '@/utils/status';
import type { DriverTrip } from '@/features/driver/types';
import { day, humanize } from '@/utils/format';
import { colors } from '@/theme';
import { useQuery } from '@/hooks';
import { ENDPOINTS } from '@/services/api';
import { ROUTES } from '@/navigation/routes';

type Me = { driver: { fullName: string; verificationStatus: string; transporter: string; assignedTanker: { registrationNumber: string } | null }; currentTrip: DriverTrip | null; upcoming: number };

export default function DriverHomeScreen() {
  const router = useRouter();
  const q = useQuery<Me>(ENDPOINTS.driver.me, { pollMs: 30_000 });
  const t = q.data?.currentTrip;
  return (
    <Page title={q.data ? `Hello, ${q.data.driver.fullName.split(' ')[0]}` : 'Driver'} subtitle={q.data ? `${q.data.driver.transporter}${q.data.driver.assignedTanker ? ` · ${q.data.driver.assignedTanker.registrationNumber}` : ''}` : undefined} refreshing={q.refreshing} onRefresh={q.refresh}>
      <QueryState loading={q.loading} error={q.error} onRetry={q.reload} />
      {q.data && q.data.driver.verificationStatus !== 'APPROVED' ? <Banner tone="info">Your documents are being verified. You can be assigned trips once approved.</Banner> : null}
      {q.data && !t ? <Card><Text style={{ color: colors.muted, textAlign: 'center' }}>No trip assigned right now.</Text></Card> : null}
      {t ? (
        <Card onPress={() => router.push(ROUTES.driver.trip(t.id))}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{t.pickup.city} → {t.delivery.city}</Text>
          <Pill label={humanize(t.status)} tone={toneFor(t.status)} />
          <Row label="Trip" value={t.tripCode} />
          <Row label="Tanker" value={t.tanker?.registrationNumber} />
          <Row label="Product" value={`${t.product} · ${t.quantityKl} KL`} />
          <Row label="Loading" value={`${day(t.loadingDate)}, ${t.loadingTime}`} />
          <Button title="Open trip" onPress={() => router.push(ROUTES.driver.trip(t.id))} />
        </Card>
      ) : null}
      {q.data && q.data.upcoming > 1 ? <Button title={`${q.data.upcoming - 1} more assigned`} variant="ghost" onPress={() => router.push(ROUTES.driver.trips)} /> : null}
    </Page>
  );
}
