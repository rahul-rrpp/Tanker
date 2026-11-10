import { Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { Card, callPhone, openMaps, Page, Pill, QueryState, Row, toneFor } from '@/components/kit';
import { Banner, Button } from '@/components/ui';
import { dateTime, humanize, km, timeAgo } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';

type Trip = { trip: { id: string; tripCode: string; status: string; booking: { bookingCode: string }; transporter: { companyName: string; contactPhone: string }; tanker: { registrationNumber: string } | null; driver: { user: { fullName: string; phone: string } } | null; pickup: { address: string } | null; delivery: { address: string } | null } };
type Tracking = { tracking: { currentPosition: { lat: number; lng: number; recordedAt: string } | null; remainingDistanceKm: number; distanceTravelledKm: number; etaAt: string | null; lastGpsAt: string | null; dataSource: string; dataSourceLabel: string } };

/** Trip progress and live position. The map opens in Google Maps / Apple Maps at the tanker's last position. */
export default function CompanyTrip() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useQuery<Trip>(`/trips/${id}`, { pollMs: 30_000 });
  const tr = useQuery<Tracking>(`/trips/${id}/tracking`, { pollMs: 30_000 });
  const x = t.data?.trip;
  const g = tr.data?.tracking;
  return (
    <Page title={x?.tripCode ?? 'Trip'} subtitle={x?.booking.bookingCode} refreshing={t.refreshing} onRefresh={() => { void t.reload(); void tr.reload(); }}>
      <Stack.Screen options={{ title: x?.tripCode ?? 'Trip' }} />
      <QueryState loading={t.loading} error={t.error} onRetry={t.reload} />
      {x ? (
        <>
          <Pill label={humanize(x.status)} tone={toneFor(x.status)} />
          {g ? (
            <Card>
              {g.dataSource === 'SIMULATED' ? <Banner tone="warning">{g.dataSourceLabel}</Banner> : <Text style={{ fontWeight: '600' }}>{g.dataSourceLabel}</Text>}
              <Row label="Travelled" value={km(g.distanceTravelledKm)} />
              <Row label="Remaining" value={km(g.remainingDistanceKm)} />
              <Row label="ETA" value={dateTime(g.etaAt)} />
              <Row label="Last update" value={timeAgo(g.lastGpsAt)} />
              {g.currentPosition ? <Button title="Show tanker on map" onPress={() => openMaps(g.currentPosition!.lat, g.currentPosition!.lng)} /> : null}
            </Card>
          ) : null}
          <Card>
            <Row label="Pickup" value={x.pickup?.address} />
            <Row label="Delivery" value={x.delivery?.address} />
            <Row label="Transporter" value={x.transporter.companyName} />
            <Row label="Tanker" value={x.tanker?.registrationNumber} />
            <Row label="Driver" value={x.driver?.user.fullName} />
          </Card>
          <Button title="Call transporter" variant="secondary" onPress={() => callPhone(x.transporter.contactPhone)} />
          {x.driver ? <Button title="Call driver" variant="secondary" onPress={() => callPhone(x.driver!.user.phone)} /> : null}
        </>
      ) : null}
    </Page>
  );
}
