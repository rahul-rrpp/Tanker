'use client';

import { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DataTable } from '@/components/DataTable';
import { ErrorState, Loading, PageHeader, Section, Select, Stat } from '@/components/ui';
import { useApi } from '@/lib/api';
import { humanize, inr, num } from '@/lib/format';

type Point = Record<string, string | number>;
type Dashboard = {
  period: { label: string; from: string; to: string };
  kpis: Record<string, number>;
  charts: {
    dailyBookings: Point[]; monthlyBookings: Point[]; companyGrowth: Point[]; transporterGrowth: Point[]; funnel: Point[]; revenue: Point[];
    routes: Point[]; capacity: Point[]; statuses: Point[]; employeePerformance: Point[];
  };
};

const RANGES = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['quarter', 'This quarter']] as const;
const BLUE = '#2563eb';
const axis = { fontSize: 11, fill: '#5b6676' };

function Chart({ title, children, height = 240 }: { title: string; children: React.ReactElement; height?: number }) {
  return <Section title={title}><div style={{ height }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div></Section>;
}

export default function DashboardPage() {
  const [range, setRange] = useState('30d');
  const { data, error, mutate } = useApi<Dashboard>(`/admin/dashboard?range=${range}`, { refreshInterval: 60_000, keepPreviousData: true });
  const k = data?.kpis;
  const c = data?.charts;
  const growth = c ? c.companyGrowth.map((p, i) => ({ month: p.month, companies: p.registrations, transporters: c.transporterGrowth[i]?.registrations ?? 0 })) : [];
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={data ? `${data.period.label} · ${data.period.from} to ${data.period.to}. Counts of companies, fleet and open items are as of now.` : 'Platform overview'}
        actions={<div className="w-44"><Select label="Period" value={range} onChange={(e) => setRange(e.target.value)}>{RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></div>}
      />
      {error ? <ErrorState error={error} onRetry={() => void mutate()} /> : !k || !c ? <Loading /> : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Companies" value={num(k.totalCompanies)} hint={`${num(k.verifiedCompanies)} verified · ${num(k.pendingCompanyVerification)} awaiting review`} href="/companies" tone={k.pendingCompanyVerification ? 'orange' : 'brand'} />
            <Stat label="Transporters" value={num(k.totalTransporters)} hint={`${num(k.verifiedTransporters)} verified`} href="/transporters" />
            <Stat label="Tankers" value={num(k.totalTankers)} hint={`${num(k.availableTankers)} available now`} href="/tankers" />
            <Stat label="Drivers" value={num(k.totalDrivers)} href="/drivers" />
            <Stat label="Bookings in period" value={num(k.totalBookings)} hint={`${num(k.pendingBookings)} still looking for a transporter`} href="/bookings" />
            <Stat label="Active trips" value={num(k.activeTrips)} hint={`${num(k.completedTrips)} delivered in period`} href="/trips" tone="green" />
            <Stat label="Cancelled in period" value={num(k.cancelledBookings)} tone={k.cancelledBookings ? 'red' : 'brand'} href="/bookings" />
            <Stat label="Open complaints" value={num(k.openComplaints)} tone={k.openComplaints ? 'orange' : 'brand'} href="/support" />
            <Stat label="Freight value confirmed" value={inr(k.freightBookingValue)} hint="In period" />
            <Stat label="Commission earned" value={inr(k.commissionRevenue)} hint="In period" href="/commissions" tone="green" />
            <Stat label="Outstanding from companies" value={inr(k.outstandingPayments)} href="/payments" tone={k.outstandingPayments ? 'orange' : 'brand'} />
            <Stat label="Due to transporters" value={inr(k.pendingSettlements)} hint={`${num(k.pendingSettlementCount)} settlements`} href="/commissions" />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Chart title="Bookings per day">
              <AreaChart data={c.dailyBookings}><CartesianGrid strokeDasharray="3 3" stroke="#e2e7ef" /><XAxis dataKey="day" tick={axis} tickFormatter={(d: string) => d.slice(5)} /><YAxis allowDecimals={false} tick={axis} width={32} /><Tooltip /><Area type="monotone" dataKey="bookings" stroke={BLUE} fill="#dbe8fe" name="Bookings" /></AreaChart>
            </Chart>
            <Chart title="Revenue by month (₹)">
              <BarChart data={c.revenue}><CartesianGrid strokeDasharray="3 3" stroke="#e2e7ef" /><XAxis dataKey="month" tick={axis} /><YAxis tick={axis} width={56} /><Tooltip formatter={(v: number) => inr(v)} /><Legend /><Bar dataKey="commission" stackId="r" fill={BLUE} name="Commission" /><Bar dataKey="subscriptions" stackId="r" fill="#60a5fa" name="Subscriptions" /><Bar dataKey="services" stackId="r" fill="#f59e0b" name="Services" /></BarChart>
            </Chart>
            <Chart title="New registrations by month">
              <BarChart data={growth}><CartesianGrid strokeDasharray="3 3" stroke="#e2e7ef" /><XAxis dataKey="month" tick={axis} /><YAxis allowDecimals={false} tick={axis} width={32} /><Tooltip /><Legend /><Bar dataKey="companies" fill={BLUE} name="Companies" /><Bar dataKey="transporters" fill="#f59e0b" name="Transporters" /></BarChart>
            </Chart>
            <Chart title="Booking funnel (period)">
              <BarChart data={c.funnel} layout="vertical" margin={{ left: 40 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e7ef" /><XAxis type="number" allowDecimals={false} tick={axis} /><YAxis type="category" dataKey="stage" tick={axis} width={130} /><Tooltip /><Bar dataKey="value" fill={BLUE} name="Bookings" /></BarChart>
            </Chart>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Section title="Top routes"><DataTable rows={c.routes} columns={[{ key: 'route', label: 'Route' }, { key: 'bookings', label: 'Bookings' }]} empty="No bookings in this period" /></Section>
            <Section title="Bookings by status"><DataTable rows={c.statuses} columns={[{ key: 'status', label: 'Status', render: (r) => humanize(String(r.status)) }, { key: 'bookings', label: 'Bookings' }]} empty="No bookings in this period" /></Section>
            <Section title="Tanker sizes requested"><DataTable rows={c.capacity} columns={[{ key: 'capacity', label: 'Capacity' }, { key: 'tankers', label: 'Tankers' }]} empty="No bookings in this period" /></Section>
          </div>

          <Section title="Employee performance (period)">
            <DataTable rows={c.employeePerformance} columns={[{ key: 'employee', label: 'Employee' }, { key: 'role', label: 'Role' }, { key: 'converted', label: 'Leads converted' }, { key: 'bookingsAssisted', label: 'Bookings assisted' }, { key: 'resolved', label: 'Complaints resolved' }, { key: 'reviews', label: 'Verifications' }, { key: 'total', label: 'Total' }]} empty="No employee activity in this period" />
          </Section>
        </div>
      )}
    </>
  );
}
