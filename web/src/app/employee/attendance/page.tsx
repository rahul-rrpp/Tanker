'use client';

import { useState } from 'react';
import { Section } from '@/components/employee/kit';
import { ActionButton, DataTable } from '@/components/transporter/ui';
import { Checkbox, EmptyState, ErrorBlock, LoadingBlock, PageHeader, Pagination, useToast } from '@/components/ui/kit';
import { Badge, Button } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateTimeIST, dayOnly, humanize } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type A = { id: string; date: string; checkInAt: string | null; checkOutAt: string | null; workingMinutes: number | null; breakMinutes: number; breakStartedAt: string | null; status: string; earlyDeparture: boolean };
type Data = { today: A | null; total: number; page: number; pageSize: number; items: A[] };
const hrs = (m: number | null) => (m === null ? '—' : `${Math.floor(m / 60)}h ${m % 60}m`);
const tone = (s: string) => (s === 'ABSENT' ? 'danger' : ['LATE', 'HALF_DAY'].includes(s) ? 'warning' : 'success');

const position = () => new Promise<{ latitude: number; longitude: number } | null>((res) => { if (!navigator.geolocation) return res(null); navigator.geolocation.getCurrentPosition((p) => res({ latitude: p.coords.latitude, longitude: p.coords.longitude }), () => res(null), { timeout: 8000 }); });

export default function Page() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi<Data>(`/employee/attendance?page=${page}`);
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  const t = data.today;
  const checkIn = async () => {
    setBusy(true);
    try {
      const loc = share ? await position() : null;
      const r = await api.post('/employee/attendance/check-in', { consent: Boolean(share && loc), ...(share && loc ? loc : {}) });
      toast.success(r.data.message);
      void mutate();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const act = (p: string, msg: string, label: string) => <ActionButton size="md" variant={p === 'check-out' ? 'primary' : 'secondary'} action={() => api.post(`/employee/attendance/${p}`, {})} success={msg} onDone={() => void mutate()}>{label}</ActionButton>;
  return (
    <>
      <PageHeader title="Attendance" />
      <Section title="Today">
        {!t?.checkInAt ? <div className="space-y-3"><Checkbox label="Share my location with this check-in" description="Optional, for field staff. Stored only for this check-in, and only if you tick this box." checked={share} onChange={setShare} /><Button loading={busy} disabled={busy} onClick={() => void checkIn()}>Check in</Button></div> : (
          <div className="space-y-3 text-sm">
            <p>Checked in {dateTimeIST(t.checkInAt)} <Badge tone={tone(t.status)}>{humanize(t.status)}</Badge></p>
            {t.checkOutAt ? <p>Checked out {dateTimeIST(t.checkOutAt)} · worked {hrs(t.workingMinutes)}{t.earlyDeparture ? ' · early departure' : ''}</p> : <div className="flex flex-wrap gap-2">{t.breakStartedAt ? act('break-end', 'Break ended', 'End break') : act('break-start', 'Break started', 'Start break')}{act('check-out', 'Checked out', 'Check out')}</div>}
          </div>
        )}
      </Section>
      <div className="mt-6">
        {data.items.length === 0 ? <EmptyState title="No attendance records" /> : <DataTable rows={data.items} rowKey={(a) => a.id} columns={[{ key: 'd', label: 'Date', render: (a) => dayOnly(a.date) }, { key: 'i', label: 'Check in', render: (a) => dateTimeIST(a.checkInAt) }, { key: 'o', label: 'Check out', render: (a) => dateTimeIST(a.checkOutAt) }, { key: 'b', label: 'Break', render: (a) => `${a.breakMinutes} min` }, { key: 'h', label: 'Working hours', render: (a) => hrs(a.workingMinutes) }, { key: 's', label: 'Status', render: (a) => <Badge tone={tone(a.status)}>{humanize(a.status)}</Badge> }]} />}
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
      </div>
    </>
  );
}
