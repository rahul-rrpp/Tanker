'use client';

import { useMemo, useState } from 'react';
import { ReportChart, type ReportChartSpec } from '@/components/portal/ReportChart';
import { DataTable } from '@/components/transporter/ui';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from '@/components/ui/kit';
import { Button, Card, SelectField, TextField } from '@/components/ui/primitives';
import { dateIST, dateTimeIST, inr, km } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type Format = 'number' | 'currency' | 'percent' | 'km' | 'date' | 'datetime' | 'text';
type Report = { key: string; title: string; summary: { label: string; value: number | string | null; format: Format }[]; columns: { key: string; label: string; format: Format }[]; rows: Record<string, unknown>[]; chart: ReportChartSpec | null };

const fmt = (v: unknown, f: Format) => {
  if (v === null || v === undefined || v === '') return '—';
  if (f === 'currency') return inr(Number(v));
  if (f === 'percent') return `${Number(v).toFixed(1)}%`;
  if (f === 'km') return km(Number(v));
  if (f === 'date') return dateIST(String(v));
  if (f === 'datetime') return dateTimeIST(String(v));
  return String(v);
};

export default function Page() {
  const { data: list } = useApi<{ reports: { key: string; title: string; group: string }[] }>('/transporters/me/reports');
  const [key, setKey] = useState('monthly-earnings');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const range = new URLSearchParams(Object.entries({ from, to }).filter(([, v]) => v)).toString();
  const { data, error, mutate } = useApi<{ report: Report }>(`/transporters/me/reports/${key}?${range}`);
  const groups = useMemo(() => [...new Set(list?.reports.map((r) => r.group))], [list]);
  const r = data?.report;
  const rows = useMemo(() => (r?.rows ?? []).filter((x) => !q || JSON.stringify(x).toLowerCase().includes(q.toLowerCase())), [r, q]);
  const exp = (f: string) => `/api/v1/transporters/me/reports/${key}/export?format=${f}${range ? `&${range}` : ''}`;
  return (
    <>
      <PageHeader title="Reports & analytics" subtitle="Calculated from your live records" actions={<><a href={exp('xlsx')} download><Button variant="secondary" size="sm">Excel</Button></a><a href={exp('pdf')} download><Button variant="secondary" size="sm">PDF</Button></a></>} />
      <Card className="mb-4 grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
        <SelectField label="Report" value={key} onChange={(e) => setKey(e.target.value)}>{groups.map((g) => <optgroup key={g} label={g}>{list?.reports.filter((x) => x.group === g).map((x) => <option key={x.key} value={x.key}>{x.title}</option>)}</optgroup>)}</SelectField>
        <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} /><TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      </Card>
      {error ? <ErrorBlock error={error} onRetry={() => void mutate()} /> : !r ? <LoadingBlock rows={6} /> : (
        <>
          <div className="mb-4 flex flex-wrap gap-3">{r.summary.map((s) => <Card key={s.label} className="min-w-40 p-4"><p className="text-xs uppercase tracking-wide text-muted">{s.label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{fmt(s.value, s.format)}</p></Card>)}</div>
          {r.chart && r.chart.data.length > 0 && <Card className="mb-4 p-5"><ReportChart spec={r.chart} /></Card>}
          {rows.length === 0 ? <EmptyState title="No records in this period" /> : <DataTable rows={rows} rowKey={(x) => JSON.stringify(x)} columns={r.columns.map((c) => ({ key: c.key, label: c.label, render: (x: Record<string, unknown>) => fmt(x[c.key], c.format) }))} />}
        </>
      )}
    </>
  );
}
