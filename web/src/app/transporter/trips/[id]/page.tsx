'use client';

import { AlertTriangle, FlaskConical } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { TripStatusBadge } from '@/components/portal/bits';
import { MapView } from '@/components/maps/MapView';
import { ActionButton, FileLinks, PromptModal, TripTimeline } from '@/components/transporter/ui';
import { DemoBadge, ErrorBlock, KV, LoadingBlock, Modal, PageHeader, SectionTitle, useToast } from '@/components/ui/kit';
import { Alert, Badge, Button, Card, SelectField, TextField } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateTimeIST, dayOnly, humanize, km, timeAgo } from '@/lib/format';
import { TRIP_DOCS, useRealtime } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

type Trip = { trip: { id: string; tripCode: string; status: string; exception: string | null; etaAt: string | null; bookingCode: string; company: string; product: string; pickup: string; delivery: string; isDemo: boolean; loadingDate: string; loadingTime: string; expectedDeliveryDate: string; tanker: { registrationNumber: string } | null; driver: { name: string; phone: string } | null }; documents: { id: string; type: string; title: string; createdAt: string; isDemo: boolean }[]; alerts: { id: string; type: string; message: string; severity: string; detectedAt: string; resolvedAt: string | null; isSimulated: boolean }[] };
type Hist = { history: { id: string; previousStatus: string | null; newStatus: string; at: string; updatedBy: string; remarks: string | null; location: { lat: number; lng: number } | null }[] };
type Tracking = { tracking: { plannedPolyline: string | null; pickup: { latitude: string; longitude: string } | null; delivery: { latitude: string; longitude: string } | null; currentPosition: { lat: number; lng: number; heading: number | null; recordedAt: string } | null; breadcrumb: { lat: number; lng: number }[]; dataSource: string; dataSourceLabel: string; remainingDistanceKm: number; lastGpsAt: string | null; etaAt: string | null } };

const ll = (p: { latitude: string; longitude: string } | null) => (p ? { lat: Number(p.latitude), lng: Number(p.longitude) } : null);

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const { data, error, mutate } = useApi<Trip>(`/trips/${id}`, { refreshInterval: 30_000 });
  const { data: h, mutate: mh } = useApi<Hist>(`/trips/${id}/history`);
  const { data: t, mutate: mt } = useApi<Tracking>(`/trips/${id}/tracking`, { refreshInterval: 30_000 });
  const [issue, setIssue] = useState(false);
  const [issueType, setIssueType] = useState('DELAYED');
  const [issueMsg, setIssueMsg] = useState('');
  const [resolving, setResolving] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [location, setLocation] = useState('');
  useRealtime(['trip:status', 'trip:location', 'trip:alert'], (e) => { if (e === 'trip:location') void mt(); else { void mutate(); void mh(); void mt(); } }, [id]);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  const x = data.trip;
  const tr = t?.tracking;
  const openAlerts = data.alerts.filter((a) => !a.resolvedAt);

  const close = async () => {
    try {
      await api.post(`/trips/${id}/complete`, location.trim() ? { availableLocation: location.trim() } : {});
      toast.success('Trip completed and tanker released');
      setClosing(false);
      void mutate();
      void mh();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <>
      <PageHeader title={`Trip ${x.tripCode}`} subtitle={<>{x.bookingCode} · {x.company} {x.isDemo && <DemoBadge />}</>} back={{ href: '/transporter/trips', label: 'Active trips' }} actions={<><TripStatusBadge status={x.status} />{x.exception && <Badge tone="danger">{x.exception.toLowerCase()}</Badge>}<Button size="sm" variant="secondary" onClick={() => setIssue(true)}>Report issue</Button><Link href={`/transporter/support/new?bookingCode=${x.bookingCode}&subject=${encodeURIComponent(`Correction request for trip ${x.tripCode}`)}`}><Button size="sm" variant="secondary">Request correction</Button></Link>{x.status === 'DELIVERED' && <Button size="sm" onClick={() => setClosing(true)}>Close trip & release tanker</Button>}</>} />
      {openAlerts.map((a) => (
        <div key={a.id} className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /><span className="min-w-0 flex-1"><strong>{humanize(a.type)}:</strong> {a.message} <span className="text-xs">({timeAgo(a.detectedAt)})</span></span>
          <Button size="sm" variant="secondary" onClick={() => setResolving(a.id)}>Resolve</Button>
        </div>
      ))}
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <div>
            <MapView className="h-80" pickup={ll(tr?.pickup ?? null)} delivery={ll(tr?.delivery ?? null)} routes={tr?.plannedPolyline ? [{ polyline: tr.plannedPolyline }] : []} breadcrumb={tr?.breadcrumb} vehicle={tr?.currentPosition ?? null} fitKey={id} />
            {tr && <p className={`mt-2 flex items-center gap-1.5 text-xs ${tr.dataSource === 'SIMULATED' ? 'font-semibold text-fuchsia-700' : 'text-muted'}`}>{tr.dataSource === 'SIMULATED' && <FlaskConical className="h-3.5 w-3.5" aria-hidden />}{tr.dataSourceLabel}{tr.lastGpsAt ? ` · last update ${timeAgo(tr.lastGpsAt)}` : ''} · {km(tr.remainingDistanceKm)} remaining</p>}
          </div>
          <Card className="p-5"><SectionTitle>Trip details</SectionTitle><dl className="divide-y divide-line"><KV label="Route">{x.pickup} → {x.delivery}</KV><KV label="Product">{x.product}</KV><KV label="Tanker">{x.tanker?.registrationNumber}</KV><KV label="Driver">{x.driver ? <>{x.driver.name} · <a className="text-brand-600" href={`tel:${x.driver.phone}`}>{x.driver.phone}</a></> : null}</KV><KV label="Loading">{dayOnly(x.loadingDate)}, {x.loadingTime}</KV><KV label="Expected delivery">{dayOnly(x.expectedDeliveryDate)}</KV><KV label="ETA">{dateTimeIST(x.etaAt)}</KV></dl></Card>
          <Card className="p-5">
            <SectionTitle>Loading documents and delivery proof</SectionTitle>
            {data.documents.length === 0 ? <p className="text-sm text-muted">Nothing uploaded yet. The driver adds these from their phone.</p> : <ul className="divide-y divide-line">{data.documents.map((d) => <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span>{TRIP_DOCS[d.type] ?? d.type}: {d.title} {d.isDemo && <DemoBadge />}<span className="block text-xs text-muted">{dateTimeIST(d.createdAt)}</span></span><FileLinks path={`/trips/${id}/documents/${d.id}/download`} /></li>)}</ul>}
          </Card>
        </div>
        <div className="space-y-5 lg:col-span-2">
          <Card className="p-5"><SectionTitle>Trip timeline</SectionTitle><TripTimeline status={x.status} history={h?.history ?? []} /></Card>
          <Card className="p-5">
            <SectionTitle>Status log</SectionTitle>
            <ol className="space-y-2 text-xs">{[...(h?.history ?? [])].reverse().map((r) => <li key={r.id}><p className="font-medium text-ink">{humanize(r.previousStatus ?? 'START')} → {humanize(r.newStatus)}</p><p className="text-muted">{dateTimeIST(r.at)} · {r.updatedBy}{r.location ? ` · ${r.location.lat.toFixed(4)}, ${r.location.lng.toFixed(4)}` : ''}{r.remarks ? ` · ${r.remarks}` : ''}</p></li>)}</ol>
          </Card>
        </div>
      </div>
      <Modal open={issue} onClose={() => setIssue(false)} title="Report an issue" footer={<><Button variant="secondary" onClick={() => setIssue(false)}>Cancel</Button><ActionButton variant="primary" size="md" disabled={issueMsg.trim().length < 5} success="Issue recorded" onDone={() => { setIssue(false); setIssueMsg(''); void mutate(); void mh(); }} action={() => api.post(`/trips/${id}/issue`, { type: issueType, message: issueMsg.trim() })}>Submit</ActionButton></>}>
        <div className="space-y-3">
          <SelectField label="Type" value={issueType} onChange={(e) => setIssueType(e.target.value)}><option value="DELAYED">Delayed</option><option value="EMERGENCY">Emergency</option><option value="CLEAR">Clear delay or emergency</option></SelectField>
          <TextField label="Details" value={issueMsg} maxLength={300} onChange={(e) => setIssueMsg(e.target.value)} />
        </div>
      </Modal>
      <PromptModal open={Boolean(resolving)} onClose={() => setResolving(null)} title="Resolve alert" label="Resolution note" submit="Resolve" multiline onSubmit={async (note) => { await api.post(`/trips/${id}/alerts/${resolving}/resolve`, { note }); toast.success('Alert resolved'); void mutate(); }} />
      <Modal open={closing} onClose={() => setClosing(false)} title="Close trip and release tanker" footer={<><Button variant="secondary" onClick={() => setClosing(false)}>Cancel</Button><Button onClick={() => void close()}>Close trip</Button></>}>
        <div className="space-y-3"><Alert tone="info">The tanker becomes available where it is now. Leave this blank to use the delivery point.</Alert><TextField label="Next available location (optional)" value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} /></div>
      </Modal>
    </>
  );
}
