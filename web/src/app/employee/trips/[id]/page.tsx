'use client';

import { use, useState } from 'react';
import { MapView } from '@/components/maps/MapView';
import { FormModal, opts, Section, useCan } from '@/components/employee/kit';
import { TripStatusBadge } from '@/components/portal/bits';
import { FileLinks } from '@/components/transporter/ui';
import { ErrorBlock, KV, LoadingBlock, PageHeader } from '@/components/ui/kit';
import { Badge, Button } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateTimeIST, dayOnly, humanize } from '@/lib/format';
import { TRIP_DOCS, TRIP_FLOW } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

type Data = { trip: { id: string; tripCode: string; status: string; bookingCode: string; company: string; companyPhone: string; transporter: string; transporterPhone: string; tanker: string | null; driver: string | null; driverPhone: string | null; pickup: string; delivery: string; loadingDate: string; expectedDeliveryDate: string; alerts: string[] }; history: { id: string; fromStatus: string | null; toStatus: string; isCorrection: boolean; reason: string | null; createdAt: string }[]; documents: { id: string; type: string; title: string }[]; alerts: { id: string; type: string; message: string; resolvedAt: string | null }[]; tracking: { plannedPolyline: string | null; pickup: { latitude: string; longitude: string } | null; delivery: { latitude: string; longitude: string } | null; currentPosition: { lat: number; lng: number; heading: number | null } | null; breadcrumb: { lat: number; lng: number }[]; dataSourceLabel: string } | null };
const ll = (p?: { latitude: string; longitude: string } | null) => (p ? { lat: Number(p.latitude), lng: Number(p.longitude) } : null);
const tel = (n?: string | null) => (n ? <a className="text-brand-600" href={`tel:${n}`}>{n}</a> : '—');

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const { data, error, mutate } = useApi<Data>(`/employee/trips/${id}`, { refreshInterval: 30_000 });
  const [m, setM] = useState<'issue' | 'fix' | null>(null);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  const t = data.trip;
  const tr = data.tracking;
  const fixes = Object.fromEntries(TRIP_FLOW.slice(0, 11).map((s) => [s, humanize(s)]));
  return (
    <>
      <PageHeader title={`Trip ${t.tripCode}`} subtitle={t.bookingCode} back={{ href: '/employee/trips', label: 'Trips' }} actions={<><TripStatusBadge status={t.status} />{can('trips.edit') && <><Button size="sm" variant="secondary" onClick={() => setM('issue')}>Raise issue</Button><Button size="sm" variant="secondary" onClick={() => setM('fix')}>Correct status</Button></>}</>} />
      {t.alerts.length > 0 && <div className="mb-4 flex flex-wrap gap-1">{t.alerts.map((a) => <Badge key={a} tone="danger">{humanize(a)}</Badge>)}</div>}
      <div className="grid gap-5 lg:grid-cols-2">
        {tr ? <div><MapView className="h-72" pickup={ll(tr.pickup)} delivery={ll(tr.delivery)} routes={tr.plannedPolyline ? [{ polyline: tr.plannedPolyline }] : []} breadcrumb={tr.breadcrumb} vehicle={tr.currentPosition} fitKey={id} /><p className="mt-1 text-xs text-muted">{tr.dataSourceLabel}</p></div> : <Section title="GPS"><p className="text-sm text-muted">You do not have GPS monitoring access.</p></Section>}
        <Section title="Details"><dl className="divide-y divide-line"><KV label="Company">{t.company} · {tel(t.companyPhone)}</KV><KV label="Transporter">{t.transporter} · {tel(t.transporterPhone)}</KV><KV label="Tanker">{t.tanker}</KV><KV label="Driver">{t.driver} · {tel(t.driverPhone)}</KV><KV label="Route">{t.pickup} → {t.delivery}</KV><KV label="Loading">{dayOnly(t.loadingDate)}</KV><KV label="Expected delivery">{dayOnly(t.expectedDeliveryDate)}</KV></dl></Section>
        <Section title="Timeline"><ol className="space-y-1.5 text-sm">{data.history.map((h) => <li key={h.id}>{humanize(h.toStatus)}{h.isCorrection && <Badge tone="warning" className="ml-1">Correction</Badge>}<span className="block text-xs text-muted">{dateTimeIST(h.createdAt)}{h.reason ? ` · ${h.reason}` : ''}</span></li>)}</ol></Section>
        <Section title="Loading and delivery proof">{data.documents.length === 0 ? <p className="text-sm text-muted">None yet.</p> : <ul className="text-sm">{data.documents.map((d) => <li key={d.id} className="flex items-center justify-between gap-2 py-1"><span>{TRIP_DOCS[d.type]}: {d.title}</span><FileLinks path={`/employee/trips/${id}/documents/${d.id}`} /></li>)}</ul>}</Section>
      </div>
      <FormModal open={m === 'issue'} onClose={() => setM(null)} title="Raise operational issue" submit="Raise" fields={[{ name: 'subject', label: 'Subject', required: true }, { name: 'description', label: 'Description', type: 'textarea', required: true }]} onSubmit={async (v) => { await api.post(`/employee/trips/${id}/issue`, v); }} />
      <FormModal open={m === 'fix'} onClose={() => setM(null)} title="Correct trip status" submit="Correct" fields={[{ name: 'status', label: 'Correct status', type: 'select', options: opts(fixes), required: true }, { name: 'reason', label: 'Reason (kept in audit history)', type: 'textarea', required: true }]} onSubmit={async (v) => { await api.post(`/employee/trips/${id}/correct-status`, v); void mutate(); }} />
    </>
  );
}
