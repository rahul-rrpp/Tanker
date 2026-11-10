import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View, Alert } from 'react-native';
import { parseApiError, ENDPOINTS } from '@/services/api';
import { Card, Chips, Pill, Button } from '@/components/ui';
import { Page } from '@/components/layout';
import { PickerModal, QueryState } from '@/components/common';
import { toneFor } from '@/utils/status';
import { dateTime, day, humanize, inr } from '@/utils/format';
import { colors } from '@/theme';
import { useQuery } from '@/hooks';
import { transporterService } from '../services/transporterService';
import { ROUTES } from '@/navigation/routes';

type Trip = { id: string; tripCode: string; status: string; tanker: { id: string; registrationNumber: string } | null; driver: { id: string; user: { fullName: string } } | null };
type Confirmed = { allocationId: string; id: string; bookingCode: string; company: { name: string }; pickup: { city: string }; delivery: { city: string }; agreedFreight: number; loadingDate: string; loadingTime: string; tankersAllocated: number; trips: Trip[] };
type Active = { id: string; tripCode: string; status: string; exception: string | null; etaAt: string | null; pickup: string; delivery: string; tanker: { registrationNumber: string } | null; driver: { name: string } | null };
type Pick = { id: string; label: string };

const REASSIGNABLE = ['SCHEDULED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'DRIVER_ACCEPTED', 'REACHED_PICKUP'];

export default function TransporterTripsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<'assign' | 'active' | 'history'>('assign');
  const confirmed = useQuery<{ items: Confirmed[] }>(tab === 'assign' ? ENDPOINTS.transporter.confirmedBookings : null);
  const trips = useQuery<{ items: Active[] }>(tab !== 'assign' ? ENDPOINTS.transporter.trips(tab) : null, { pollMs: 60_000 });
  const tankers = useQuery<{ items: { id: string; registrationNumber: string; capacityKl: number; verificationStatus: string; status: string }[] }>(ENDPOINTS.transporter.tankers);
  const drivers = useQuery<{ items: { id: string; fullName: string; verificationStatus: string; isActive: boolean }[] }>(ENDPOINTS.transporter.drivers);
  const [picking, setPicking] = useState<{ kind: 'tanker' | 'driver'; bookingId: string; tripId: string } | null>(null);

  const items: Pick[] = picking?.kind === 'tanker'
    ? (tankers.data?.items ?? []).filter((t) => t.verificationStatus === 'APPROVED').map((t) => ({ id: t.id, label: `${t.registrationNumber} · ${t.capacityKl} KL · ${humanize(t.status)}` }))
    : (drivers.data?.items ?? []).filter((d) => d.verificationStatus === 'APPROVED' && d.isActive).map((d) => ({ id: d.id, label: d.fullName }));

  const assign = async (p: Pick) => {
    if (!picking) return;
    try {
      // The server re-checks compliance, availability and overlaps; the database blocks double booking.
      await transporterService.assign(picking.bookingId, picking.kind, { tripId: picking.tripId, [`${picking.kind}Id`]: p.id });
      Alert.alert('Assigned', `${picking.kind === 'tanker' ? 'Tanker' : 'Driver'} assigned`);
      void confirmed.reload();
    } catch (e) {
      Alert.alert('Could not assign', parseApiError(e).message);
    }
  };
  const q = tab === 'assign' ? confirmed : trips;
  return (
    <Page title="Trips" refreshing={q.refreshing} onRefresh={q.refresh}>
      <Chips value={tab} options={[{ value: 'assign', label: 'Confirmed (assign)' }, { value: 'active', label: 'Active' }, { value: 'history', label: 'History' }]} onChange={setTab} />
      <QueryState loading={q.loading} error={q.error} empty={tab === 'assign' ? confirmed.data?.items.length === 0 : trips.data?.items.length === 0} emptyText="Nothing here" onRetry={q.reload} />
      {tab === 'assign' && confirmed.data?.items.map((b) => (
        <Card key={b.allocationId}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>{b.pickup.city} → {b.delivery.city}</Text>
          <Text style={{ color: colors.muted }}>{b.bookingCode} · {b.company.name} · {inr(b.agreedFreight)}</Text>
          <Text style={{ color: colors.ink }}>Loading {day(b.loadingDate)} {b.loadingTime}</Text>
          {b.trips.map((t) => (
            <View key={t.id} style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8, marginTop: 4, gap: 6 }}>
              <Text style={{ fontWeight: '600' }} onPress={() => router.push(ROUTES.transporter.trip(t.id))}>{t.tripCode} · {humanize(t.status)}</Text>
              <Text style={{ color: colors.muted }}>{t.tanker?.registrationNumber ?? 'No tanker'} · {t.driver?.user.fullName ?? 'No driver'}</Text>
              {REASSIGNABLE.includes(t.status) ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}><Button title={t.tanker ? 'Change tanker' : 'Assign tanker'} variant="secondary" onPress={() => setPicking({ kind: 'tanker', bookingId: b.id, tripId: t.id })} /></View>
                  <View style={{ flex: 1 }}><Button title={t.driver ? 'Change driver' : 'Assign driver'} variant="secondary" disabled={!t.tanker} onPress={() => setPicking({ kind: 'driver', bookingId: b.id, tripId: t.id })} /></View>
                </View>
              ) : null}
            </View>
          ))}
        </Card>
      ))}
      {tab !== 'assign' && trips.data?.items.map((t) => (
        <Card key={t.id} onPress={() => router.push(ROUTES.transporter.trip(t.id))}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>{t.pickup} → {t.delivery}</Text>
          <Text style={{ color: colors.muted }}>{t.tripCode} · {t.tanker?.registrationNumber ?? '—'} · {t.driver?.name ?? '—'}</Text>
          {t.etaAt ? <Text style={{ color: colors.muted }}>ETA {dateTime(t.etaAt)}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 6 }}><Pill label={humanize(t.status)} tone={toneFor(t.status)} />{t.exception ? <Pill label={humanize(t.exception)} tone="danger" /> : null}</View>
        </Card>
      ))}
      <PickerModal visible={Boolean(picking)} title={picking?.kind === 'tanker' ? 'Choose tanker' : 'Choose driver'} items={items} onClose={() => setPicking(null)} onPick={(p) => void assign(p)} />
    </Page>
  );
}
