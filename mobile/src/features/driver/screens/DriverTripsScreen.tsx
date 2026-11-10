import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Card, Chips, Pill } from '@/components/ui';
import { Page } from '@/components/layout';
import { QueryState } from '@/components/common';
import { toneFor } from '@/utils/status';
import type { DriverTrip } from '@/features/driver/types';
import { day, humanize } from '@/utils/format';
import { colors } from '@/theme';
import { useQuery } from '@/hooks';
import { ENDPOINTS } from '@/services/api';
import { ROUTES } from '@/navigation/routes';

export default function DriverTripsScreen() {
  const router = useRouter();
  const [scope, setScope] = useState<'active' | 'history'>('active');
  const q = useQuery<{ items: DriverTrip[] }>(ENDPOINTS.driver.trips(scope));
  return (
    <Page title="My trips" refreshing={q.refreshing} onRefresh={q.refresh}>
      <Chips value={scope} options={[{ value: 'active', label: 'Assigned' }, { value: 'history', label: 'History' }]} onChange={setScope} />
      <QueryState loading={q.loading} error={q.error} empty={q.data?.items.length === 0} emptyText="No trips" onRetry={q.reload} />
      {q.data?.items.map((t) => (
        <Card key={t.id} onPress={() => router.push(ROUTES.driver.trip(t.id))}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>{t.pickup.city} → {t.delivery.city}</Text>
          <Text style={{ color: colors.muted }}>{t.tripCode} · {t.tanker?.registrationNumber} · loading {day(t.loadingDate)} {t.loadingTime}</Text>
          <Pill label={humanize(t.status)} tone={toneFor(t.status)} />
        </Card>
      ))}
    </Page>
  );
}
