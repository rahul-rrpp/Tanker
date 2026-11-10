'use client';

import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ActionButton } from '@/components/transporter/ui';
import { EmptyState, ErrorBlock, LoadingBlock, Modal, PageHeader, SectionTitle, StatusBadge, useToast } from '@/components/ui/kit';
import { Button, Card, SelectField, TextField } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';
import { dateTimeIST, todayIST } from '@/lib/format';
import { TANKER_STATUS } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

type Block = { id: string; kind: string; startAt: string; endAt: string; note: string | null };
type TripW = { id: string; tripCode: string; status: string; plannedStartAt: string | null; plannedEndAt: string | null; booking: { bookingCode: string; locations: { type: string; city: string }[] } };
type T = { id: string; registrationNumber: string; status: string; capacityKl: number; availableFrom: string | null; availableLocation: string | null; verificationStatus: string; availabilityBlocks: Block[]; trips: TripW[] };

const DAYS = 21;
const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400_000).toISOString().slice(0, 10);
/** Datetime-local value read as India time. */
const ist = (v: string) => new Date(`${v}:00+05:30`).toISOString();

export default function Page() {
  const toast = useToast();
  const [from, setFrom] = useState(todayIST());
  const { data, error, mutate } = useApi<{ tankers: T[] }>(`/tankers/availability/calendar?from=${from}`, { refreshInterval: 60_000 });
  const [edit, setEdit] = useState<T | null>(null);
  const [f, setF] = useState({ kind: 'BLOCKED', startAt: '', endAt: '', note: '', location: '', availableFrom: '' });
  const [busy, setBusy] = useState(false);
  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(from, i)), [from]);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock rows={6} />;

  const cell = (t: T, day: string) => {
    const s = new Date(`${day}T00:00:00+05:30`).getTime();
    const e = s + 86400_000;
    const hit = (a: string | null, b: string | null) => a && b && new Date(a).getTime() < e && new Date(b).getTime() > s;
    if (t.trips.some((x) => hit(x.plannedStartAt, x.plannedEndAt))) return 'bg-brand-500';
    const b = t.availabilityBlocks.find((x) => hit(x.startAt, x.endAt));
    if (b) return b.kind === 'MAINTENANCE' ? 'bg-orange-400' : 'bg-slate-400';
    return 'bg-green-100';
  };

  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value })) });
  const saveBlock = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      await api.put(`/tankers/${edit.id}/availability`, { ...(f.startAt && f.endAt ? { block: { kind: f.kind, startAt: ist(f.startAt), endAt: ist(f.endAt), ...(f.note ? { note: f.note } : {}) } } : {}), ...(f.location ? { availableLocation: f.location } : {}), ...(f.availableFrom ? { availableFrom: ist(f.availableFrom) } : {}) });
      toast.success('Availability updated');
      setEdit(null);
      setF({ kind: 'BLOCKED', startAt: '', endAt: '', note: '', location: '', availableFrom: '' });
      void mutate();
    } catch (e) {
      toast.error(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Tanker availability" subtitle="Marketplace matching uses these dates and locations" actions={<><Button size="sm" variant="secondary" aria-label="Earlier" onClick={() => setFrom(addDays(from, -DAYS))}><ChevronLeft className="h-4 w-4" /></Button><Button size="sm" variant="secondary" onClick={() => setFrom(todayIST())}>Today</Button><Button size="sm" variant="secondary" aria-label="Later" onClick={() => setFrom(addDays(from, DAYS))}><ChevronRight className="h-4 w-4" /></Button></>} />
      {data.tankers.length === 0 ? <EmptyState title="No tankers yet" /> : (
        <>
          <Card className="overflow-x-auto p-4">
            <table className="w-full min-w-[820px] border-separate border-spacing-0.5 text-xs">
              <thead><tr><th scope="col" className="w-36 text-left font-medium text-muted">Tanker</th>{days.map((d) => <th key={d} scope="col" className="font-normal text-muted">{d.slice(8)}<span className="block text-[10px]">{new Date(`${d}T00:00:00Z`).toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' })}</span></th>)}</tr></thead>
              <tbody>{data.tankers.map((t) => <tr key={t.id}><th scope="row" className="text-left font-semibold text-ink">{t.registrationNumber}</th>{days.map((d) => <td key={d} className={clsx('h-7 rounded', cell(t, d))} title={d} />)}</tr>)}</tbody>
            </table>
            <p className="mt-3 flex flex-wrap gap-4 text-xs text-muted">{[['bg-green-100', 'Free'], ['bg-brand-500', 'Assigned'], ['bg-orange-400', 'Maintenance'], ['bg-slate-400', 'Blocked']].map(([c, l]) => <span key={l} className="flex items-center gap-1.5"><span className={clsx('h-3 w-3 rounded', c)} aria-hidden /> {l}</span>)}</p>
          </Card>
          <section className="mt-6 space-y-3">
            <SectionTitle>Tankers</SectionTitle>
            {data.tankers.map((t) => (
              <Card key={t.id} className="p-4">
                <div className="flex flex-wrap items-center gap-3"><strong className="text-sm">{t.registrationNumber}</strong><StatusBadge map={TANKER_STATUS} value={t.status} /><span className="min-w-0 flex-1 text-xs text-muted">{t.availableLocation ? `At ${t.availableLocation}` : 'Location not set'}{t.availableFrom ? `, from ${dateTimeIST(t.availableFrom)}` : ''}</span><Button size="sm" variant="secondary" onClick={() => setEdit(t)}>Set dates or location</Button></div>
                {(t.trips.length > 0 || t.availabilityBlocks.length > 0) && (
                  <ul className="mt-2 space-y-1 text-xs text-muted">
                    {t.trips.map((x) => <li key={x.id}>Assigned: {x.tripCode} ({x.booking.locations.map((l) => l.city).join(' → ')}) {dateTimeIST(x.plannedStartAt)} to {dateTimeIST(x.plannedEndAt)}</li>)}
                    {t.availabilityBlocks.map((b) => <li key={b.id} className="flex items-center gap-2">{b.kind === 'MAINTENANCE' ? 'Maintenance' : 'Blocked'}: {dateTimeIST(b.startAt)} to {dateTimeIST(b.endAt)}{b.note ? ` · ${b.note}` : ''}<ActionButton action={() => api.put(`/tankers/${t.id}/availability`, { cancelBlockId: b.id })} success="Removed" onDone={() => void mutate()}>Remove</ActionButton></li>)}
                  </ul>
                )}
              </Card>
            ))}
          </section>
        </>
      )}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit ? `Availability: ${edit.registrationNumber}` : ''} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} disabled={busy} onClick={() => void saveBlock()}>Save</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><TextField label="Available at (location)" {...bind('location')} /></div>
          <div className="sm:col-span-2"><TextField label="Available from" type="datetime-local" {...bind('availableFrom')} /></div>
          <div className="sm:col-span-2"><SelectField label="Block these dates as" {...bind('kind')}><option value="BLOCKED">Blocked</option><option value="MAINTENANCE">Maintenance</option></SelectField></div>
          <TextField label="From" type="datetime-local" {...bind('startAt')} /><TextField label="To" type="datetime-local" {...bind('endAt')} />
          <div className="sm:col-span-2"><TextField label="Note" {...bind('note')} /></div>
        </div>
      </Modal>
    </>
  );
}
