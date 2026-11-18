import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { Banner, Button, ManifestTable, Pill, RouteRail, T, Ticket, Waybill } from '@/components/ui';
import { callPhone, openMaps } from '@/utils/linking';
import { Page } from '@/components/layout';
import { QueryState } from '@/components/common';
import { toneFor } from '@/utils/status';
import { dateTime, humanize, km, routeText, timeAgo } from '@/utils/format';
import { colors } from '@/theme';
import { useQuery } from '@/hooks';
import { ENDPOINTS } from '@/services/api';

type Place = { address: string; city: string | null } | null;
type Trip = { trip: { id: string; tripCode: string; status: string; booking: { bookingCode: string }; transporter: { companyName: string; contactPhone: string }; tanker: { registrationNumber: string } | null; driver: { user: { fullName: string; phone: string } } | null; pickup: Place; delivery: Place } };
type Tracking = { tracking: { currentPosition: { lat: number; lng: number; recordedAt: string } | null; remainingDistanceKm: number; distanceTravelledKm: number; etaAt: string | null; lastGpsAt: string | null; dataSource: string; dataSourceLabel: string } };

/**
 * One trip, read the way a dispatcher reads it: when does it arrive (the ink ticket), where is it on the
 * route (the rail with the live marker), who is carrying it (manifest + call buttons).
 */
export default function CompanyTripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useQuery<Trip>(ENDPOINTS.trips.detail(id), { pollMs: 30_000 });
  const tr = useQuery<Tracking>(ENDPOINTS.trips.tracking(id), { pollMs: 30_000 });
  const x = t.data?.trip;
  const g = tr.data?.tracking;
  const total = g ? Number(g.distanceTravelledKm) + Number(g.remainingDistanceKm) : 0;
  const progress = g && total ? Number(g.distanceTravelledKm) / total : null;
  const moving = x?.status === 'IN_TRANSIT';

  return (
    <Page
      eyebrow={x ? `Trip · ${x.tripCode}` : 'Trip'}
      title={x ? routeText(x.pickup?.city, x.delivery?.city) : 'Trip'}
      subtitle={x ? `Booking ${x.booking.bookingCode}` : undefined}
      refreshing={t.refreshing}
      onRefresh={() => { void t.reload(); void tr.reload(); }}
    >
      <Stack.Screen options={{ title: '' }} />
      <QueryState loading={t.loading} error={t.error} onRetry={t.reload} skeleton="detail" />
      {x ? (
        <>
          <Ticket style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <T v="eyebrow" c="onInkMuted">{g?.etaAt ? 'Arrives' : 'Status'}</T>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: moving ? colors.accent : colors.onInkMuted }} />
                <T v="label" c="onInk">{humanize(x.status)}</T>
              </View>
            </View>
            <T v="display" c="onInk" style={{ fontSize: 30, lineHeight: 34 }}>{g?.etaAt ? dateTime(g.etaAt) : humanize(x.status)}</T>
            {g ? (
              <>
                <View style={{ height: 3, backgroundColor: colors.inkLine, borderRadius: 2, overflow: 'hidden' }}>
                  <View style={{ width: `${(progress ?? 0) * 100}%`, height: '100%', backgroundColor: colors.accent }} />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <T v="code" c="onInk">{km(g.distanceTravelledKm)} done</T>
                  <T v="code" c="onInk">{km(g.remainingDistanceKm)} to go</T>
                </View>
                <T v="caption" c="onInkMuted">Updated {timeAgo(g.lastGpsAt)} · {g.dataSourceLabel}</T>
              </>
            ) : (
              <T v="caption" c="onInkMuted">Live position appears once the driver starts the trip.</T>
            )}
          </Ticket>
          {g?.dataSource === 'SIMULATED' ? <Banner tone="warning">Position is simulated for this demo trip.</Banner> : null}

          <Waybill style={{ gap: 16 }}>
            <RouteRail from={x.pickup?.city} to={x.delivery?.city} fromDetail={x.pickup?.address} toDetail={x.delivery?.address} progress={progress} />
            {g?.currentPosition ? <Button title="Show tanker on map" icon="map-outline" variant="secondary" onPress={() => openMaps(g.currentPosition!.lat, g.currentPosition!.lng)} /> : null}
          </Waybill>

          <ManifestTable
            title="Carrier"
            style={{ marginTop: 8 }}
            items={[
              { label: 'Transporter', value: x.transporter.companyName, strong: true },
              { label: 'Tanker', value: x.tanker?.registrationNumber ?? 'Not assigned yet', mono: Boolean(x.tanker) },
              { label: 'Driver', value: x.driver?.user.fullName ?? 'Not assigned yet' },
              { label: 'Status', value: <Pill label={humanize(x.status)} tone={toneFor(x.status)} live={moving} /> },
            ]}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Call transporter" icon="call-outline" variant="secondary" style={{ flex: 1 }} onPress={() => callPhone(x.transporter.contactPhone)} />
            {x.driver ? <Button title="Call driver" icon="call-outline" variant="secondary" style={{ flex: 1 }} onPress={() => callPhone(x.driver!.user.phone)} /> : null}
          </View>
        </>
      ) : null}
    </Page>
  );
}
