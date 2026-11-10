'use client';

import { AlertTriangle, FlaskConical } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { TripStatusBadge } from '@/components/portal/bits';
import { MapView } from '@/components/maps/MapView';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from '@/components/ui/kit';
import { Badge, Card, SelectField, TextField } from '@/components/ui/primitives';
import { dateTimeIST, humanize, timeAgo } from '@/lib/format';
import { TRIP_STATUS } from '@/lib/status';
import { useRealtime } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

type V = { id: string; tripCode: string; status: string; etaAt: string | null; lastGpsAt: string | null; isSimulated: boolean; pickup: string; delivery: string; tanker: { registrationNumber: string } | null; driver: { name: string } | null; position: { lat: number; lng: number } | null; alerts: { id: string; type: string; message: string; severity: string; isSimulated: boolean }[] };
type Tracking = { tracking: { plannedPolyline: string | null; pickup: { latitude: string; longitude: string } | null; delivery: { latitude: string; longitude: string } | null; breadcrumb: { lat: number; lng: number }[]; currentPosition: { lat: number; lng: number; heading: number | null } | null; dataSourceLabel: string } };

const ll = (p: { latitude: string; longitude: string } | null | undefined) => (p ? { lat: Number(p.latitude), lng: Number(p.longitude) } : null);

export default function Page() {
  const { data, error, mutate } = useApi<{ vehicles: V[] }>('/transporters/me/active-vehicles', { refreshInterval: 30_000 });
  const [f, setF] = useState({ vehicle: '', driver: '', status: '', pickup: '', delivery: '' });
  const [selected, setSelected] = useState<string | null>(null);
  const { data: tr, mutate: mt } = useApi<Tracking>(selected ? `/trips/${selected}/tracking` : null, { refreshInterval: 30_000 });
  useRealtime(['trip:location', 'trip:status', 'trip:alert'], () => { void mutate(); void mt(); });
  const vehicles = useMemo(() => {
    const has = (v: string | undefined | null, q: string) => !q || (v ?? '').toLowerCase().includes(q.toLowerCase());
    return (data?.vehicles ?? []).filter((v) => has(v.tanker?.registrationNumber, f.vehicle) && has(v.driver?.name, f.driver) && (!f.status || v.status === f.status) && has(v.pickup, f.pickup) && has(v.delivery, f.delivery));
  }, [data, f]);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  const t = tr?.tracking;
  const markers = vehicles.filter((v) => v.position && v.id !== selected).map((v) => ({ id: v.id, lat: v.position!.lat, lng: v.position!.lng }));
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value })) });
  return (
    <>
      <PageHeader title="Live GPS tracking" subtitle="Positions come from driver phones or fitted GPS devices. Coverage depends on the device reporting." />
      <Card className="mb-4 grid grid-cols-2 gap-3 p-4 md:grid-cols-5">
        <TextField label="Vehicle number" {...bind('vehicle')} /><TextField label="Driver" {...bind('driver')} />
        <SelectField label="Trip status" {...bind('status')}><option value="">Any</option>{Object.entries(TRIP_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</SelectField>
        <TextField label="Pickup city" {...bind('pickup')} /><TextField label="Delivery city" {...bind('delivery')} />
      </Card>
      {data.vehicles.length === 0 ? <EmptyState title="No active tankers">Tankers appear here once assigned to a trip.</EmptyState> : (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="max-h-[560px] space-y-2 overflow-y-auto lg:col-span-2">
            {vehicles.map((v) => (
              <button key={v.id} onClick={() => setSelected(v.id)} className={`w-full rounded-xl border bg-white p-3 text-left text-sm ${selected === v.id ? 'border-brand-500 ring-2 ring-brand-100' : 'border-line hover:border-brand-200'}`}>
                <span className="flex items-center justify-between gap-2"><strong>{v.tanker?.registrationNumber}</strong><TripStatusBadge status={v.status} /></span>
                <span className="mt-1 block text-xs text-muted">{v.tripCode} · {v.driver?.name ?? 'No driver'} · {v.pickup} → {v.delivery}</span>
                <span className="mt-0.5 block text-xs text-muted">{v.lastGpsAt ? `Last GPS ${timeAgo(v.lastGpsAt)}` : 'No GPS yet'} · ETA {dateTimeIST(v.etaAt)}</span>
                {v.isSimulated && <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-fuchsia-700"><FlaskConical className="h-3 w-3" aria-hidden /> Simulated, not live GPS</span>}
                {v.alerts.map((a) => <Badge key={a.id} tone="danger" className="mr-1 mt-1"><AlertTriangle className="h-3 w-3" aria-hidden /> {humanize(a.type)}</Badge>)}
              </button>
            ))}
          </div>
          <div className="lg:col-span-3">
            <MapView className="h-[560px]" pickup={ll(t?.pickup)} delivery={ll(t?.delivery)} routes={t?.plannedPolyline ? [{ polyline: t.plannedPolyline }] : []} breadcrumb={t?.breadcrumb} vehicle={t?.currentPosition ?? null} markers={markers} onMarker={setSelected} fitKey={selected ?? 'fleet'} />
            {selected && <p className="mt-2 text-xs text-muted">{t?.dataSourceLabel} · <Link className="font-semibold text-brand-600" href={`/transporter/trips/${selected}`}>Open trip</Link></p>}
          </div>
        </div>
      )}
    </>
  );
}
