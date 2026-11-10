'use client';

import clsx from 'clsx';
import { FileSpreadsheet, FileText, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { ReportChart, type ReportChartSpec } from '@/components/portal/ReportChart';
import { DemoBadge, EmptyState, ErrorBlock, LoadingBlock, PageHeader, SectionTitle } from '@/components/ui/kit';
import { Button, Card, SelectField, TextField } from '@/components/ui/primitives';
import { dateIST, dateTimeIST, inr, todayIST } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type Format = 'number' | 'currency' | 'percent' | 'text' | 'date' | 'datetime' | 'km';
interface Report {
  key: string;
  title: string;
  description: string;
  range: { from: string; to: string };
  summary: { label: string; value: number | string | null; format: Format }[];
  chart: ReportChartSpec | null;
  columns: { key: string; label: string; format: Format }[];
  rows: Record<string, unknown>[];
}

const fmt = (v: unknown, f: Format) => {
  if (v === null || v === undefined || v === '') return '—';
  switch (f) {
    case 'currency':
      return inr(Number(v));
    case 'percent':
      return `${Number(v).toFixed(1)}%`;
    case 'km':
      return `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })} km`;
    case 'number':
      return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    case 'date':
      return dateIST(v as string);
    case 'datetime':
      return dateTimeIST(v as string);
    default:
      return String(v);
  }
};

const shift = (iso: string, months: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

const PRESETS = [
  { label: 'Last 30 days', from: () => shift(todayIST(), -1) },
  { label: 'Last 3 months', from: () => shift(todayIST(), -3) },
  { label: 'Last 12 months', from: () => shift(todayIST(), -12) },
  { label: 'This year', from: () => `${todayIST().slice(0, 4)}-01-01` },
];

function ReportsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: list } = useApi<{ reports: { key: string; title: string; description: string }[] }>('/reports');
  const active = params.get('report') ?? 'total-bookings';
  const [from, setFrom] = useState(params.get('from') ?? shift(todayIST(), -12));
  const [to, setTo] = useState(params.get('to') ?? todayIST());
  const [q, setQ] = useState('');
  const query = new URLSearchParams({ from, to });
  const { data, error, isLoading, mutate } = useApi<{ report: Report }>(from <= to ? `/reports/${active}?${query}` : null, { keepPreviousData: true });
  const r = data?.report;

  const rows = useMemo(() => {
    if (!r) return [];
    const needle = q.trim().toLowerCase();
    return needle ? r.rows.filter((row) => r.columns.some((c) => String(row[c.key] ?? '').toLowerCase().includes(needle))) : r.rows;
  }, [r, q]);

  const select = (key: string) => {
    setQ('');
    router.replace(`/company/reports?report=${key}`, { scroll: false });
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Reports & Analytics" subtitle="Live reports calculated from your booking, trip and payment records. Export to Excel or PDF." />
      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Report list */}
        <div className="lg:hidden">
          <SelectField label="Report" value={active} onChange={(e) => select(e.target.value)} options={(list?.reports ?? []).map((x) => ({ value: x.key, label: x.title }))} />
        </div>
        <nav className="hidden lg:block" aria-label="Reports">
          <ul className="space-y-1 rounded-2xl border border-line bg-white p-2 shadow-[var(--shadow-card)]">
            {(list?.reports ?? []).map((x, i) => (
              <li key={x.key}>
                <button onClick={() => select(x.key)} aria-current={x.key === active ? 'page' : undefined} className={clsx('w-full rounded-xl px-3 py-2 text-left text-sm transition-colors', x.key === active ? 'bg-brand-600 font-semibold text-white' : 'text-ink hover:bg-canvas')}>
                  <span className={clsx('mr-2 text-xs tabular-nums', x.key === active ? 'text-brand-100' : 'text-muted')}>{String(i + 1).padStart(2, '0')}</span>
                  {x.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-5">
          <Card>
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-ink">{r?.title ?? list?.reports.find((x) => x.key === active)?.title}</h2>
                <p className="text-sm text-muted">{r?.description}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={`/api/v1/reports/${active}/export?${query}&format=xlsx`} download className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-field)] border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-canvas">
                  <FileSpreadsheet className="h-4 w-4 text-green-700" /> Export Excel
                </a>
                <a href={`/api/v1/reports/${active}/export?${query}&format=pdf`} download className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-field)] border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-canvas">
                  <FileText className="h-4 w-4 text-red-700" /> Export PDF
                </a>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="sm:w-44">
                <TextField label="From" type="date" max={to} value={from} onChange={(e) => setFrom(e.target.value)} error={from > to ? 'After "To"' : undefined} />
              </div>
              <div className="sm:w-44">
                <TextField label="To" type="date" min={from} max={todayIST()} value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <Button
                    key={p.label}
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setFrom(p.from());
                      setTo(todayIST());
                    }}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
          </Card>

          {error ? (
            <ErrorBlock error={error} onRetry={() => mutate()} />
          ) : isLoading && !r ? (
            <LoadingBlock rows={6} />
          ) : !r ? null : (
            <>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                {r.summary.map((s) => (
                  <div key={s.label} className="rounded-2xl border border-line bg-white p-4 shadow-[var(--shadow-card)]">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">{s.label}</p>
                    <p className="mt-2 truncate text-xl font-bold tabular-nums text-ink" title={String(s.value ?? '')}>
                      {fmt(s.value, s.format)}
                    </p>
                  </div>
                ))}
              </div>
              {r.chart && (
                <Card>
                  <SectionTitle>{r.chart.series.length > 1 ? 'Comparison' : r.chart.series[0].label}</SectionTitle>
                  <ReportChart spec={r.chart} />
                </Card>
              )}
              <Card className="!p-0">
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted">
                    {rows.length} of {r.rows.length} row(s) · {r.range.from} to {r.range.to}
                  </p>
                  <div className="relative sm:w-64">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this report" aria-label="Search this report" className="h-9 w-full rounded-[var(--radius-field)] border border-line pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100" />
                  </div>
                </div>
                {rows.length === 0 ? (
                  <div className="px-4 pb-4">
                    <EmptyState title="No records">Try a wider date range.</EmptyState>
                  </div>
                ) : (
                  <div className="max-h-[560px] overflow-auto">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead className="sticky top-0 bg-white">
                        <tr className="border-y border-line text-left text-xs uppercase tracking-wide text-muted">
                          {r.columns.map((c) => (
                            <th key={c.key} className={clsx('px-4 py-2.5 font-medium', ['currency', 'number', 'percent', 'km'].includes(c.format) && 'text-right')}>
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 500).map((row, i) => (
                          <tr key={i} className="border-b border-line last:border-0 hover:bg-canvas/60">
                            {r.columns.map((c, j) => (
                              <td key={c.key} className={clsx('px-4 py-2.5', ['currency', 'number', 'percent', 'km'].includes(c.format) && 'text-right tabular-nums')}>
                                {j === 0 && typeof row.bookingId === 'string' ? (
                                  <Link href={`/company/bookings/${row.bookingId}`} className="font-semibold text-brand-700 hover:underline">
                                    {fmt(row[c.key], c.format)}
                                  </Link>
                                ) : (
                                  fmt(row[c.key], c.format)
                                )}
                                {j === 0 && Boolean(row.demo) && (
                                  <span className="ml-1.5 align-middle">
                                    <DemoBadge />
                                  </span>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rows.length > 500 && <p className="p-4 text-xs text-muted">Showing the first 500 rows. Export to Excel for the full report.</p>}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} />}>
      <ReportsInner />
    </Suspense>
  );
}
