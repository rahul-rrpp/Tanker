import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Text, View } from 'react-native';
import { parseApiError, ENDPOINTS } from '@/services/api';
import { Banner, Button, Card, IconBadge, InfoCard, InfoRow, Pill, SectionTitle, SummaryCard } from '@/components/ui';
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
      if (r === 'denied') Alert.alert('Location is off', 'Allow location for OnlyTanker in your phone settings to share trip progress.');
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
  // Presentation only: where the next action sits in the fixed driver step order.
  const steps = Object.keys(ACTION_LABEL);
  const stepIndex = t?.nextAction ? steps.indexOf(t.nextAction) : t ? steps.length : 0;
  const sharing = gps.mine && gps.running;
  return (
    <Page title="Trip" subtitle={t ? `${t.product} · ${t.quantityKl} KL` : undefined} refreshing={q.refreshing} onRefresh={q.refresh}>
      <Stack.Screen options={{ title: t?.tripCode ?? 'Trip' }} />
      <QueryState loading={q.loading} error={q.error} onRetry={q.reload} skeleton="detail" />
      {t ? (
        <>
          <SummaryCard code={t.tripCode} status={<Pill label={humanize(t.status)} tone={toneFor(t.status)} />} from={t.pickup.city} to={t.delivery.city} fromDetail={t.pickup.address} toDetail={t.delivery.address} />

          {t.nextAction || t.status === 'DELIVERED' ? (
            <Card style={{ gap: 12, backgroundColor: colors.brand900, borderColor: colors.brand900 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.brand100, fontSize: 12, fontWeight: '700', letterSpacing: 0.6 }}>NEXT STEP</Text>
                <Text style={{ color: colors.brand100, fontSize: 12 }}>{Math.min(stepIndex + 1, steps.length)} of {steps.length}</Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
                <View style={{ width: `${(Math.min(stepIndex, steps.length) / steps.length) * 100}%`, height: '100%', backgroundColor: colors.accentLight, borderRadius: 3 }} />
              </View>
              {t.nextAction === 'SUBMIT_COMPLETION' && !hasProof ? (
                <Banner tone="info">Upload the signed delivery proof to submit completion.</Banner>
              ) : t.nextAction ? (
                <Button title={ACTION_LABEL[t.nextAction] ?? humanize(t.nextAction)} icon="arrow-forward-circle-outline" loading={busy} onPress={() => void step()} style={{ height: 60, backgroundColor: colors.accent }} />
              ) : null}
              {t.status === 'DELIVERED' ? <Banner tone="success">Trip submitted. Your transporter will close it.</Banner> : null}
            </Card>
          ) : null}

          {toward ? <Button title={`Navigate to ${toward.city ?? 'destination'}`} icon="navigate-outline" variant="secondary" onPress={() => openMaps(toward.lat, toward.lng)} /> : null}

          {t.locationSharingAllowed ? (
            <Card style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <IconBadge icon={sharing ? 'radio-outline' : 'location-outline'} tone={sharing ? 'success' : 'neutral'} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800', color: colors.ink, fontSize: 15 }}>Live location</Text>
                  <Text style={{ color: sharing ? colors.success : colors.muted, fontSize: 12, marginTop: 1 }}>{sharing ? 'Sharing, including with the screen locked' : 'Not sharing'}</Text>
                </View>
              </View>
              <InfoRow icon="cloud-done-outline" label="Last received" value={timeAgo(t.lastGpsAt)} last={!gps.queued} />
              {gps.queued ? <InfoRow icon="cloud-offline-outline" label="Waiting to send" value={gps.queued} last /> : null}
              {sharing ? <Button title="Stop sharing" icon="stop-circle-outline" variant="secondary" onPress={() => void stopTripTracking().then(refreshGps)} /> : <Button title="Share live location" icon="radio-outline" onPress={() => void share()} />}
            </Card>
          ) : null}

          <InfoCard
            title="Pickup"
            items={[
              { icon: 'location-outline', label: 'Address', value: t.pickup.address },
              { icon: 'calendar-outline', label: 'Loading', value: `${day(t.loadingDate)}, ${t.loadingTime}` },
              t.loadingInstructions ? { icon: 'information-circle-outline', label: 'Instructions', value: t.loadingInstructions } : null,
            ]}
            footer={<Button title={`Call ${t.loadingContact.name}`} icon="call-outline" variant="secondary" onPress={() => callPhone(t.loadingContact.phone)} />}
          />
          <InfoCard
            title="Delivery"
            items={[
              { icon: 'flag-outline', label: 'Address', value: t.delivery.address },
              { icon: 'calendar-outline', label: 'Deliver by', value: day(t.expectedDeliveryDate) },
              t.deliveryInstructions ? { icon: 'information-circle-outline', label: 'Instructions', value: t.deliveryInstructions } : null,
            ]}
            footer={<Button title={`Call ${t.deliveryContact.name}`} icon="call-outline" variant="secondary" onPress={() => callPhone(t.deliveryContact.phone)} />}
          />

          {!['COMPLETED', 'CANCELLED'].includes(t.status) || q.data?.documents.length ? <SectionTitle>Documents</SectionTitle> : null}
          {q.data?.documents.length ? (
            <Card style={{ gap: 10 }}>
              {q.data.documents.map((d) => (
                <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <IconBadge icon="checkmark-done-outline" tone="success" size={34} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', color: colors.ink }}>{humanize(d.type)}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{dateTime(d.createdAt)}</Text>
                  </View>
                </View>
              ))}
            </Card>
          ) : null}
          {!['COMPLETED', 'CANCELLED'].includes(t.status) ? (
            <>
              <Button title="Add delivery proof" icon="camera-outline" variant={t.nextAction === 'SUBMIT_COMPLETION' ? 'primary' : 'secondary'} onPress={() => void addDoc('DELIVERY_PROOF')} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><Button title="Loading slip" icon="receipt-outline" variant="secondary" onPress={() => void addDoc('LOADING_SLIP')} /></View>
                <View style={{ flex: 1 }}><Button title="Other" icon="document-outline" variant="secondary" onPress={() => void addDoc('OTHER')} /></View>
              </View>
            </>
          ) : null}

          {!['COMPLETED', 'CANCELLED', 'DELIVERED'].includes(t.status) ? <Button title="Emergency assistance" icon="warning-outline" variant="danger" onPress={() => setEmergency(true)} /> : null}
          <PromptModal visible={emergency} title="Emergency assistance" label="What has happened?" submit="Alert my transporter" hint="For danger to life, call 112 first." onClose={() => setEmergency(false)} onSubmit={async (message) => { await driverService.emergency(id, { message, ...(await currentPoint()) }); Alert.alert('Sent', 'Your transporter has been alerted.'); void q.reload(); }} />
        </>
      ) : null}
    </Page>
  );
}
