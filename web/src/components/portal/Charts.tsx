'use client';

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { compactInr, inr, monthLabel } from '@/lib/format';

/**
 * Single-series charts (one brand hue, no legend needed — the card title names the series).
 * Spend and booking counts are separate charts: never a dual axis.
 */
const BLUE = '#2563eb';
const GRID = '#e2e7ef';
const AXIS = { fontSize: 11, fill: '#5b6676' };

function TooltipBox({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-lg">
      <p className="text-muted">{title}</p>
      <p className="mt-0.5 font-semibold text-ink">{value}</p>
    </div>
  );
}

export function MonthlySpendChart({ data }: { data: { month: string; spend: number; trips: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="month" tickFormatter={monthLabel} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v: number) => compactInr(v)} tick={AXIS} axisLine={false} tickLine={false} width={58} />
        <Tooltip
          cursor={{ fill: 'rgba(37,99,235,0.06)' }}
          content={({ active, payload }) =>
            active && payload?.[0] ? <TooltipBox title={`${monthLabel(String(payload[0].payload.month))} · ${payload[0].payload.trips} trip(s)`} value={inr(Number(payload[0].value))} /> : null
          }
        />
        <Bar dataKey="spend" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MonthlyBookingsChart({ data }: { data: { month: string; bookings: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="month" tickFormatter={monthLabel} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} width={32} />
        <Tooltip
          cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }}
          content={({ active, payload }) => (active && payload?.[0] ? <TooltipBox title={monthLabel(String(payload[0].payload.month))} value={`${payload[0].value} booking(s)`} /> : null)}
        />
        <Line type="monotone" dataKey="bookings" stroke={BLUE} strokeWidth={2} dot={{ r: 4, fill: BLUE, stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function RouteSpendChart({ data }: { data: { route: string; spend: number; trips: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 44)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" tickFormatter={(v: number) => compactInr(v)} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="route" tick={{ ...AXIS, fill: '#0b1b3f' }} axisLine={false} tickLine={false} width={150} />
        <Tooltip
          cursor={{ fill: 'rgba(37,99,235,0.06)' }}
          content={({ active, payload }) => (active && payload?.[0] ? <TooltipBox title={`${payload[0].payload.route} · ${payload[0].payload.trips} trip(s)`} value={inr(Number(payload[0].value))} /> : null)}
        />
        <Bar dataKey="spend" fill={BLUE} radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const STATUS_COLOR: Record<string, string> = {
  searching: '#ea580c',
  negotiation: '#f59e0b',
  confirmed: '#2563eb',
  in_transit: '#1d4ed8',
  completed: '#16a34a',
  cancelled: '#dc2626',
};

/** Booking status breakdown: labelled horizontal bars (labels carry identity, colour reinforces state). */
export function StatusOverviewChart({ data }: { data: { key: string; label: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-3">
      {data.map((d) => (
        <div key={d.key}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-ink">{d.label}</span>
            <span className="tabular-nums text-muted">
              {d.value} {total ? `· ${Math.round((d.value / total) * 100)}%` : ''}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-canvas" role="img" aria-label={`${d.label}: ${d.value} bookings`}>
            <div className="h-full rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: STATUS_COLOR[d.key] ?? BLUE }} />
          </div>
        </div>
      ))}
      <p className="pt-1 text-xs text-muted">{total} booking(s) in total</p>
    </div>
  );
}
