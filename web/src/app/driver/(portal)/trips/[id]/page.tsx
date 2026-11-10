'use client';

import { AlertOctagon, MapPin, Navigation, Phone, Radio, WifiOff } from 'lucide-react';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { TripStatusBadge } from '@/components/portal/bits';
import { MapView } from '@/components/maps/MapView';
import { ActionButton, DocumentUpload, FileLinks, PromptModal } from '@/components/transporter/ui';
import { ErrorBlock, LoadingBlock, SectionTitle, useToast } from '@/components/ui/kit';
import { Alert, Badge, Button, Card } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateTimeIST, dayOnly, timeAgo } from '@/lib/format';
import { DRIVER_ACTION_LABEL, TRIP_DOCS, useRealtime } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';
import type { DriverTrip } from '../../dashboard/page';

type Data = { trip: DriverTrip; documents: { id: string; type: string; title: string; createdAt: string }[]; history: { id: string; toStatus: string; createdAt: string }[] };
type Point = { latitude: number; longitude: number; speedKmph?: number | null; heading?: number | null; recordedAt: string };

const queueKey = (id: string) => `tl.gps.${id}`;
const SEND_EVERY_MS = 30_000;
const readQueue = (id: string): Point[] => {
  try {
    return JSON.parse(localStorage.getItem(queueKey(id)) ?? '[]') as Point[];
  } catch {
    return [];
  }
};
const writeQueue = (id: string, q: Point[]) => {
  try {
    localStorage.setItem(queueKey(id), JSON.stringify(q.slice(-500)));
  } catch {
    /* storage full or blocked: points stay unsent, which is reported as "not sent" */
  }
};

/**
 * Foreground location sharing with explicit permission. A browser stops reporting when the screen locks or
 * the tab is backgrounded, so this is never described as continuous tracking; points captured while offline
 * are queued and sent on reconnect. Continuous tracking needs the native app or fitted GPS hardware.
 */
function useLocationSharing(tripId: string, allowed: boolean, onSent: () => void) {
  const [sharing, setSharing] = useState(false);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied' | 'prompt' | 'unsupported'>('unknown');
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [queued, setQueued] = useState(0);
  const [online, setOnline] = useState(true);
  const watch = useRef<number | null>(null);
  const lastCapture = useRef(0);

  useEffect(() => {
    if (!('geolocation' in navigator)) return setPermission('unsupported');
    void navigator.permissions?.query({ name: 'geolocation' as PermissionName }).then((p) => {
      setPermission(p.state);
      p.onchange = () => setPermission(p.state);
    });
    setOnline(navigator.onLine);
    setQueued(readQueue(tripId).length);
  }, [tripId]);

  const flush = useCallback(async () => {
    const q = readQueue(tripId);
    if (q.length === 0 || !navigator.onLine) return;
    const batch = q.slice(0, 200);
    try {
      await api.post(`/driver/me/trips/${tripId}/location`, { points: batch });
      const rest = q.slice(batch.length);
      writeQueue(tripId, rest);
      setQueued(rest.length);
      setLastSent(new Date().toISOString());
      onSent();
    } catch {
      setQueued(q.length); // retried on the next tick
    }
  }, [tripId, onSent]);

  const stop = useCallback(() => {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    setSharing(false);
  }, []);

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) return;
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        if (Date.now() - lastCapture.current < SEND_EVERY_MS) return;
        lastCapture.current = Date.now();
        const q = [...readQueue(tripId), { latitude: p.coords.latitude, longitude: p.coords.longitude, speedKmph: p.coords.speed === null ? null : Math.min(250, p.coords.speed * 3.6), heading: p.coords.heading, recordedAt: new Date(p.timestamp).toISOString() }];
        writeQueue(tripId, q);
        setQueued(q.length);
        void flush();
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED) {
          setPermission('denied');
          stop();
        }
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
    );
    setSharing(true);
    setPermission('granted');
  }, [tripId, flush, stop]);

  useEffect(() => {
    const on = () => {
      setOnline(true);
      void flush();
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [flush]);

  // Sharing ends automatically when the trip no longer permits it.
  useEffect(() => {
    if (!allowed && watch.current !== null) stop();
  }, [allowed, stop]);
  useEffect(() => () => { if (watch.current !== null) navigator.geolocation.clearWatch(watch.current); }, []);

  return { sharing, permission, lastSent, queued, online, start, stop };
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const { data, error, mutate } = useApi<Data>(`/driver/me/trips/${id}`, { refreshInterval: 30_000 });
  const [emergency, setEmergency] = useState(false);
  const noop = useCallback(() => undefined, []);
  const gps = useLocationSharing(id, Boolean(data?.trip.locationSharingAllowed), noop);
  useRealtime(['trip:status'], () => void mutate(), [id]);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock rows={6} />;
  const t = data.trip;
  const needProof = t.nextAction === 'SUBMIT_COMPLETION' && !data.documents.some((d) => d.type === 'DELIVERY_PROOF');
  const towards = t.nextAction && ['CONFIRM_ASSIGNMENT', 'REACHED_PICKUP'].includes(t.nextAction) ? t.pickup : t.delivery;
  const position = () => new Promise<{ latitude?: number; longitude?: number }>((res) => navigator.geolocation?.getCurrentPosition((p) => res({ latitude: p.coords.latitude, longitude: p.coords.longitude }), () => res({}), { timeout: 4000, maximumAge: 60_000 }) ?? res({}));
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2"><div><h1 className="text-xl font-bold text-ink">{t.tripCode}</h1><p className="text-xs text-muted">{t.bookingCode} · {t.product}</p></div><span className="flex flex-col items-end gap-1"><TripStatusBadge status={t.status} />{t.exception && <Badge tone="danger">{t.exception.toLowerCase()}</Badge>}</span></div>
      {t.nextAction && (needProof ? <Alert tone="info" title="Upload delivery proof">Add the signed delivery proof below to submit completion.</Alert> : <ActionButton variant="primary" size="md" className="w-full py-4 text-base" success="Updated" onDone={() => void mutate()} action={async () => api.post(`/driver/me/trips/${id}/status`, { action: t.nextAction, ...(await position()) })}>{DRIVER_ACTION_LABEL[t.nextAction]}</ActionButton>)}
      {t.status === 'DELIVERED' && <Alert tone="success" title="Trip submitted">Your transporter will close the trip.</Alert>}
      <MapView className="h-56" pickup={t.pickup} delivery={t.delivery} routes={t.routePolyline ? [{ polyline: t.routePolyline }] : []} fitKey={id} />
      <a className="block" target="_blank" rel="noopener" href={`https://www.google.com/maps/dir/?api=1&destination=${towards.lat},${towards.lng}&travelmode=driving`}><Button fullWidth variant="secondary"><Navigation className="h-4 w-4" aria-hidden /> Navigate to {towards.city}</Button></a>

      {t.locationSharingAllowed && (
        <Card className="space-y-2 p-4">
          <SectionTitle>Location sharing</SectionTitle>
          {!gps.online && <p className="flex items-center gap-1.5 text-sm text-orange-700"><WifiOff className="h-4 w-4" aria-hidden /> Offline. Points are saved and sent on reconnect.</p>}
          <p className="text-sm">Permission: <strong>{gps.permission}</strong>{gps.sharing && <span className="ml-2 inline-flex items-center gap-1 text-green-700"><Radio className="h-3.5 w-3.5" aria-hidden /> Sharing</span>}</p>
          <p className="text-xs text-muted">Last successful update: {gps.lastSent ? timeAgo(gps.lastSent) : t.lastGpsAt ? timeAgo(t.lastGpsAt) : 'none yet'}{gps.queued ? ` · ${gps.queued} waiting to send` : ''}</p>
          <p className="text-xs text-muted">Keep this screen open. Updates pause if your phone locks or you switch apps.</p>
          {gps.permission === 'denied' ? <Alert tone="error">Location is blocked. Allow it in your browser settings for this site.</Alert> : gps.sharing ? <Button fullWidth variant="secondary" onClick={gps.stop}>Stop sharing</Button> : <Button fullWidth onClick={gps.start} disabled={gps.permission === 'unsupported'}>Share my location</Button>}
        </Card>
      )}

      <Card className="space-y-3 p-4 text-sm">
        <div><p className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden /><span>{t.pickup.address}</span></p><p className="ml-6 text-xs text-muted">Loading {dayOnly(t.loadingDate)}, {t.loadingTime}{t.loadingInstructions ? ` · ${t.loadingInstructions}` : ''}</p><a className="ml-6 inline-flex items-center gap-1 text-brand-600" href={`tel:${t.loadingContact.phone}`}><Phone className="h-3.5 w-3.5" aria-hidden /> {t.loadingContact.name}</a></div>
        <div><p className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden /><span>{t.delivery.address}</span></p><p className="ml-6 text-xs text-muted">By {dayOnly(t.expectedDeliveryDate)}{t.deliveryInstructions ? ` · ${t.deliveryInstructions}` : ''}</p><a className="ml-6 inline-flex items-center gap-1 text-brand-600" href={`tel:${t.deliveryContact.phone}`}><Phone className="h-3.5 w-3.5" aria-hidden /> {t.deliveryContact.name}</a></div>
        <p className="text-xs text-muted">Tanker {t.tanker?.registrationNumber} · {t.tanker?.capacityKl} KL · {t.quantityKl} KL to load</p>
      </Card>

      {!['COMPLETED', 'CANCELLED'].includes(t.status) && <Card className="p-4"><SectionTitle>Upload documents</SectionTitle><DocumentUpload endpoint={`/driver/me/trips/${id}/documents`} types={needProof ? { DELIVERY_PROOF: TRIP_DOCS.DELIVERY_PROOF, ...TRIP_DOCS } : TRIP_DOCS} fieldName="type" label="Choose file or photo" onDone={() => void mutate()} />
        {data.documents.length > 0 && <ul className="mt-3 divide-y divide-line">{data.documents.map((d) => <li key={d.id} className="flex items-center justify-between gap-2 py-2 text-sm"><span className="min-w-0 truncate">{TRIP_DOCS[d.type]}<span className="block text-xs text-muted">{dateTimeIST(d.createdAt)}</span></span><FileLinks path={`/driver/me/trips/${id}/documents/${d.id}/download`} /></li>)}</ul>}
      </Card>}

      {!['COMPLETED', 'CANCELLED', 'DELIVERED'].includes(t.status) && <Button fullWidth variant="danger" onClick={() => setEmergency(true)}><AlertOctagon className="h-4 w-4" aria-hidden /> Emergency assistance</Button>}
      <PromptModal open={emergency} onClose={() => setEmergency(false)} title="Emergency assistance" label="What has happened?" submit="Alert my transporter" multiline hint="For danger to life, call 112 first." onSubmit={async (message) => { await api.post(`/driver/me/trips/${id}/emergency`, { message, ...(await position()) }); toast.success('Your transporter has been alerted'); void mutate(); }} />
    </div>
  );
}
