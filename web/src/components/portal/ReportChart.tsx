'use client';

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { compactInr, inr, monthLabel } from '@/lib/format';

type Format = 'number' | 'currency' | 'percent' | 'text' | 'date' | 'datetime' | 'km';
export interface ReportChartSpec {
  type: 'bar' | 'line' | 'pie';
  xKey: string;
  series: { key: string; label: string; format: Format }[];
  data: Record<string, unknown>[];
}

// Fixed categorical order (never cycled): agreed/primary first.
const SERIES_COLORS = ['#2563eb', '#94a3b8', '#7c3aed'];
const GRID = '#e2e7ef';
const AXIS = { fontSize: 11, fill: '#5b6676' };

const fmtValue = (v: unknown, f: Format) => (f === 'currency' ? inr(Number(v)) : f === 'percent' ? `${Number(v).toFixed(1)}%` : f === 'km' ? `${Number(v)} km` : Number(v).toLocaleString('en-IN'));
const fmtAxis = (v: number, f: Format) => (f === 'currency' ? compactInr(v) : f === 'percent' ? `${v}%` : v.toLocaleString('en-IN'));
const xLabel = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}$/.test(v) ? monthLabel(v) : String(v));

function Tip({ active, payload, label, series }: { active?: boolean; payload?: { dataKey: string; value: number }[]; label?: unknown; series: ReportChartSpec['series'] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 text-muted">{xLabel(label)}</p>
      {payload.map((p) => {
        const s = series.find((x) => x.key === p.dataKey)!;
        return (
          <p key={p.dataKey} className="font-semibold text-ink">
            {series.length > 1 ? `${s.label}: ` : ''}
            {fmtValue(p.value, s.format)}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Generic report chart. "pie" requests render as a ranked horizontal bar (easier to compare than slices).
 * Multi-series charts carry a legend; single-series charts are named by the card title.
 */
export function ReportChart({ spec }: { spec: ReportChartSpec }) {
  if (!spec.data.length) return <p className="py-10 text-center text-sm text-muted">No data for this period.</p>;
  const f = spec.series[0].format;
  if (spec.type === 'line') {
    return (
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={spec.data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey={spec.xKey} tickFormatter={xLabel} tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v: number) => fmtAxis(v, f)} tick={AXIS} axisLine={false} tickLine={false} width={56} allowDecimals={false} />
          <Tooltip content={<Tip series={spec.series} />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} />
          {spec.series.map((s, i) => (
            <Line key={s.key} dataKey={s.key} name={s.label} stroke={SERIES_COLORS[i]} strokeWidth={2} dot={{ r: 4, fill: SERIES_COLORS[i], stroke: '#fff', strokeWidth: 2 }} />
          ))}
          {spec.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        </LineChart>
      </ResponsiveContainer>
    );
  }
  const horizontal = spec.type === 'pie' || spec.data.some((d) => String(d[spec.xKey]).length > 14);
  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height={Math.max(180, spec.data.length * 40)}>
        <BarChart data={spec.data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" tickFormatter={(v: number) => fmtAxis(v, f)} tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey={spec.xKey} tickFormatter={xLabel} tick={{ ...AXIS, fill: '#0b1b3f' }} axisLine={false} tickLine={false} width={160} />
          <Tooltip content={<Tip series={spec.series} />} cursor={{ fill: 'rgba(37,99,235,0.06)' }} />
          {spec.series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES_COLORS[i]} radius={[0, 4, 4, 0]} maxBarSize={22} />
          ))}
          {spec.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={spec.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="24%" barGap={2}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey={spec.xKey} tickFormatter={xLabel} tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tickFormatter={(v: number) => fmtAxis(v, f)} tick={AXIS} axisLine={false} tickLine={false} width={58} allowDecimals={false} />
        <Tooltip content={<Tip series={spec.series} />} cursor={{ fill: 'rgba(37,99,235,0.06)' }} />
        {spec.series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES_COLORS[i]} radius={[4, 4, 0, 0]} maxBarSize={36} />
        ))}
        {spec.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
      </BarChart>
    </ResponsiveContainer>
  );
}
