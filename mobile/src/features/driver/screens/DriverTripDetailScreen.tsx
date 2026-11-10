import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Text } from 'react-native';
import { parseApiError, ENDPOINTS } from '@/services/api';
import { Card, Pill, Row, SectionTitle, Banner, Button } from '@/components/ui';
import { callPhone, openMaps } from '@/utils/linking';
import { Page } from '@/components/layout';
import { PromptModal, QueryState } from '@/components/common';
import { toneFor } from '@/utils/status';
import { pickFile } from '@/utils/pickFile';
import { currentPoint, flushLocations, startTripTracking, stopTripTracking, trackingState } from '@/features/driver/services/locationTracking';
import { ACTION_LABEL, type DriverTrip } from '@/features/driver/types';
import { dateTime, day, humanize, timeAgo } from '@/utils/format';
import { colors } from '@/theme';
import { useQuery } from '@/hooks';
import { driverService } from '../services/driverService';

type D = { trip: DriverTrip; documents: { id: string; type: string; title: string; createdAt: string }[] };

/** The driver's working screen: one big next-step button, navigation, live location, documents, emergency. */
export default function DriverTripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery<D>(ENDPOINTS.driver.trip(id), { pollMs: 30_000 });
  const [busy, setBusy] = useState(false);
  const [emergency, setEmergency] = useState(false);
  const [gps, setGps] = useState<{ running: boolean; queued: number; mine: boolean }>({ running: false, queued: 0, mine: false });
  const t = q.data?.trip;

  const refreshGps = useCallback(async () => {
    const s = await trackingState();
    setGps({ running: s.running, queued: s.queued, mine: s.tripId === id });
  }, [id]);
  useEffect(() => {
    void refreshGps();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') { void flushLocations().then(refreshGps); } });
    const timer = setInterval(() => void refreshGps(), 15_000);
    return () => { sub.remove(); clearInterval(timer); };
  }, [refreshGps]);

  // Tracking stops automatically once the trip leaves the stages where sharing is allowed.
  useEffect(() => {
    if (t && !t.locationSharingAllowed && gps.mine && gps.running) void stopTripTracking().then(refreshGps);
  }, [t, gps.mine, gps.running, refreshGps]);

  const hasProof = Boolean(q.data?.documents.some((d) => d.type === 'DELIVERY_PROOF'));
  const step = async () => {
    if (!t?.nextAction) return;
    setBusy(true);
    try {
      await driverService.updateStatus(id, { action: t.nextAction, ...(await currentPoint()) });
      // Starting the trip is the natural moment to begin live tracking (the driver still has to agree).
      if (t.nextAction === 'CONFIRM_ASSIGNMENT' && !gps.running) {
        Alert.alert('Share live location?', 'Your transporter and customer see the tanker on the map while this trip is active, even with the screen locked.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Share', onPress: () => void share() },
        ]);
      }
      await q.reload();
    } catch (e) {
      Alert.alert('Could not update', parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  const share = async () => {
    try {
      const r = await startTripTracking(String(id));
      if (r === 'denied') Alert.alert('Location is off', 'Allow location for TankerLink in your phone settings to share trip progress.');
      else if (r === 'foreground-only') Alert.alert('Limited sharing', 'Location is shared only while the app is open. Choose "Allow all the time" in settings to keep sharing when the screen is locked.');
    } catch (e) {
      Alert.alert('Could not start sharing', (e as Error).message);
    }
    await refreshGps();
  };
  const addDoc = async (type: string) => {
    const f = await pickFile();
    if (!f) return;
    try {
      await driverService.uploadDocument(id, type, f);
      Alert.alert('Uploaded', 'Document saved to this trip.');
      void q.reload();
    } catch (e) {
      Alert.alert('Upload failed', parseApiError(e).message);
    }
  };

  const toward = t && ['CONFIRM_ASSIGNMENT', 'REACHED_PICKUP'].includes(t.nextAction ?? '') ? t.pickup : t?.delivery;
  return (
    <Page title={t ? `${t.pickup.city} → ${t.delivery.city}` : 'Trip'} subtitle={t ? `${t.tripCode} · ${t.product}` : undefined} refreshing={q.refreshing} onRefresh={q.refresh}>
      <Stack.Screen options={{ title: t?.tripCode ?? 'Trip' }} />
      <QueryState loading={q.loading} error={q.error} onRetry={q.reload} />
      {t ? (
        <>
          <Pill label={humanize(t.status)} tone={toneFor(t.status)} />
          {t.nextAction === 'SUBMIT_COMPLETION' && !hasProof ? (
            <Banner tone="info">Upload the signed delivery proof to submit completion.</Banner>
          ) : t.nextAction ? (
            <Button title={ACTION_LABEL[t.nextAction] ?? humanize(t.nextAction)} loading={busy} onPress={() => void step()} style={{ paddingVertical: 18 }} />
          ) : null}
          {t.status === 'DELIVERED' ? <Banner tone="success">Trip submitted. Your transporter will close it.</Banner> : null}
          {toward ? <Button title={`Navigate to ${toward.city ?? 'destination'}`} variant="secondary" onPress={() => openMaps(toward.lat, toward.lng)} /> : null}

          {t.locationSharingAllowed ? (
            <Card>
              <Text style={{ fontWeight: '700', color: colors.ink }}>Live location</Text>
              <Text style={{ color: gps.mine && gps.running ? colors.success : colors.muted }}>{gps.mine && gps.running ? 'Sharing, including with the screen locked' : 'Not sharing'}</Text>
              <Row label="Last received by server" value={timeAgo(t.lastGpsAt)} />
              {gps.queued ? <Row label="Waiting to send (offline)" value={gps.queued} /> : null}
              {gps.mine && gps.running ? <Button title="Stop sharing" variant="secondary" onPress={() => void stopTripTracking().then(refreshGps)} /> : <Button title="Share live location" onPress={() => void share()} />}
            </Card>
          ) : null}

          <Card>
            <Row label="Pickup" value={t.pickup.address} />
            <Row label="Loading" value={`${day(t.loadingDate)}, ${t.loadingTime}`} />
            {t.loadingInstructions ? <Row label="Instructions" value={t.loadingInstructions} /> : null}
            <Button title={`Call ${t.loadingContact.name}`} variant="ghost" onPress={() => callPhone(t.loadingContact.phone)} />
          </Card>
          <Card>
            <Row label="Delivery" value={t.delivery.address} />
            <Row label="By" value={day(t.expectedDeliveryDate)} />
            {t.deliveryInstructions ? <Row label="Instructions" value={t.deliveryInstructions} /> : null}
            <Button title={`Call ${t.deliveryContact.name}`} variant="ghost" onPress={() => callPhone(t.deliveryContact.phone)} />
          </Card>

          {!['COMPLETED', 'CANCELLED'].includes(t.status) ? (
            <>
              <SectionTitle>Documents</SectionTitle>
              <Button title="Add delivery proof" variant={t.nextAction === 'SUBMIT_COMPLETION' ? 'primary' : 'secondary'} onPress={() => void addDoc('DELIVERY_PROOF')} />
              <Button title="Add loading slip" variant="secondary" onPress={() => void addDoc('LOADING_SLIP')} />
              <Button title="Add other document" variant="ghost" onPress={() => void addDoc('OTHER')} />
            </>
          ) : null}
          {q.data?.documents.map((d) => <Text key={d.id} style={{ color: colors.ink }}>✓ {humanize(d.type)} · {dateTime(d.createdAt)}</Text>)}

          {!['COMPLETED', 'CANCELLED', 'DELIVERED'].includes(t.status) ? <Button title="Emergency assistance" variant="danger" onPress={() => setEmergency(true)} /> : null}
          <PromptModal visible={emergency} title="Emergency assistance" label="What has happened?" submit="Alert my transporter" hint="For danger to life, call 112 first." onClose={() => setEmergency(false)} onSubmit={async (message) => { await driverService.emergency(id, { message, ...(await currentPoint()) }); Alert.alert('Sent', 'Your transporter has been alerted.'); void q.reload(); }} />
        </>
      ) : null}
    </Page>
  );
}
