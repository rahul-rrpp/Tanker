import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Card, Chips, Page, Pill, QueryState, toneFor } from '@/components/kit';
import { dateTime, humanize } from '@/lib/format';
import { colors } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';

export type CompanyTrip = { id: string; tripCode: string; status: string; etaAt: string | null; trackingSource: string; booking: { bookingCode: string }; pickup: { city: string | null } | null; delivery: { city: string | null } | null; tanker: { registrationNumber: string } | null; driver: { user: { fullName: string } } | null; transporter: { companyName: string } };

export default function Trips() {
  const router = useRouter();
  const [scope, setScope] = useState<'active' | 'completed' | 'all'>('active');
  const q = useQuery<{ trips: CompanyTrip[] }>(`/trips?scope=${scope}`, { pollMs: 60_000 });
  return (
    <Page title="Trips" refreshing={q.refreshing} onRefresh={q.refresh}>
      <Chips value={scope} options={[{ value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' }, { value: 'all', label: 'All' }]} onChange={setScope} />
      <QueryState loading={q.loading} error={q.error} empty={q.data?.trips.length === 0} emptyText="No trips here" onRetry={q.reload} />
      {q.data?.trips.map((t) => (
        <Card key={t.id} onPress={() => router.push(`/company/trip/${t.id}`)}>
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
