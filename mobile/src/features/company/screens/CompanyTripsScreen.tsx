import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Card, Chips, Pill } from '@/components/ui';
import { Page } from '@/components/layout';
import { QueryState } from '@/components/common';
import { toneFor } from '@/utils/status';
import { dateTime, humanize } from '@/utils/format';
import { colors } from '@/theme';
import { useQuery } from '@/hooks';
import type { CompanyTrip } from '../types';
import { ENDPOINTS } from '@/services/api';
import { ROUTES } from '@/navigation/routes';


export default function CompanyTripsScreen() {
  const router = useRouter();
  const [scope, setScope] = useState<'active' | 'completed' | 'all'>('active');
  const q = useQuery<{ trips: CompanyTrip[] }>(ENDPOINTS.company.trips(scope), { pollMs: 60_000 });
  return (
    <Page title="Trips" refreshing={q.refreshing} onRefresh={q.refresh}>
      <Chips value={scope} options={[{ value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' }, { value: 'all', label: 'All' }]} onChange={setScope} />
      <QueryState loading={q.loading} error={q.error} empty={q.data?.trips.length === 0} emptyText="No trips here" onRetry={q.reload} />
      {q.data?.trips.map((t) => (
        <Card key={t.id} onPress={() => router.push(ROUTES.company.trip(t.id))}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>{t.pickup?.city} → {t.delivery?.city}</Text>
          <Text style={{ color: colors.muted }}>{t.tripCode} · {t.booking.bookingCode} · {t.transporter.companyName}</Text>
          <Text style={{ color: colors.ink }}>{t.tanker?.registrationNumber ?? 'Tanker not assigned'} · {t.driver?.user.fullName ?? 'Driver not assigned'}</Text>
          {t.etaAt ? <Text style={{ color: colors.muted }}>ETA {dateTime(t.etaAt)}</Text> : null}
          <Pill label={humanize(t.status)} tone={toneFor(t.status)} />
        </Card>
      ))}
    </Page>
  );
}
