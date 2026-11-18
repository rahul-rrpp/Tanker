import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { Banner, Button, Card, InfoCard, Pill, SummaryCard } from '@/components/ui';
import { HeroPage } from '@/components/layout';
import { EmptyState, QueryState } from '@/components/common';
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
  const d = q.data?.driver;
  return (
    <HeroPage
      eyebrow="Driver"
      title={d ? `Hello, ${d.fullName.split(' ')[0]}` : 'Driver'}
      subtitle={d ? `${d.transporter}${d.assignedTanker ? ` · ${d.assignedTanker.registrationNumber}` : ''}` : undefined}
      avatarName={d?.fullName}
      refreshing={q.refreshing}
      onRefresh={q.refresh}
    >
      <QueryState loading={q.loading} error={q.error} onRetry={q.reload} skeleton="detail" />
      {q.data && q.data.driver.verificationStatus !== 'APPROVED' ? <Banner tone="info">Your documents are being verified. You can be assigned trips once approved.</Banner> : null}
      {q.data && !t ? (
        <Card><EmptyState text="No trip assigned right now" icon="cafe-outline" hint="Your transporter assigns trips here. Pull down to refresh." /></Card>
      ) : null}
      {t ? (
        <>
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.ink }}>Current trip</Text>
          <SummaryCard code={t.tripCode} status={<Pill label={humanize(t.status)} tone={toneFor(t.status)} />} from={t.pickup.city} to={t.delivery.city} fromDetail={t.pickup.address} toDetail={t.delivery.address}>
            <Button title="Open trip" icon="arrow-forward-circle-outline" onPress={() => router.push(ROUTES.driver.trip(t.id))} style={{ height: 56 }} />
          </SummaryCard>
          <InfoCard
            items={[
              { icon: 'bus-outline', label: 'Tanker', value: t.tanker?.registrationNumber },
              { icon: 'flask-outline', label: 'Product', value: `${t.product} · ${t.quantityKl} KL` },
              { icon: 'calendar-outline', label: 'Loading', value: `${day(t.loadingDate)}, ${t.loadingTime}` },
            ]}
          />
        </>
      ) : null}
      {q.data && q.data.upcoming > 1 ? <Button title={`${q.data.upcoming - 1} more assigned`} icon="list-outline" variant="secondary" onPress={() => router.push(ROUTES.driver.trips)} /> : null}
    </HeroPage>
  );
}
