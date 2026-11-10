'use client';

import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Section } from '@/components/employee/kit';
import { DataTable } from '@/components/transporter/ui';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, Tabs } from '@/components/ui/kit';
import { Badge } from '@/components/ui/primitives';
import { useApi } from '@/lib/useApi';

type Row = { code: string; kpi: string; actual: number; monthlyTarget: number; expected: number; achievement: number; weight: number; weightedScore: number; rating: string };
type Data = { employee: { name: string; role: string }; period: string; rows: Row[]; totalScore: number; rating: string };

export default function Page() {
  const [period, setPeriod] = useState('month');
  const { data, error, mutate } = useApi<Data>(`/employee/performance?period=${period}`);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  return (
    <>
      <PageHeader title="Performance scorecard" subtitle={`${data.employee.name} · ${data.employee.role}`} actions={<Badge tone="info">Score {data.totalScore} · {data.rating}</Badge>} />
      <div className="mb-4"><Tabs tabs={[{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }]} value={period} onChange={setPeriod} /></div>
      {data.rows.length === 0 ? <EmptyState title="No targets set for your role">Your administrator sets targets and weightage.</EmptyState> : (
        <>
          <DataTable rows={data.rows} rowKey={(r) => r.code} columns={[{ key: 'k', label: 'KPI', render: (r) => r.kpi }, { key: 'a', label: 'Actual', render: (r) => r.actual }, { key: 't', label: 'Monthly target', render: (r) => r.monthlyTarget }, { key: 'e', label: 'Expected', render: (r) => r.expected }, { key: 'p', label: 'Achievement', render: (r) => `${r.achievement}%` }, { key: 'w', label: 'Weight', render: (r) => r.weight }, { key: 's', label: 'Weighted score', render: (r) => r.weightedScore }, { key: 'r', label: 'Rating', render: (r) => r.rating }]} />
          <div className="mt-5"><Section title="Achievement by KPI (%)"><ResponsiveContainer width="100%" height={260}><BarChart data={data.rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e2e7ef" /><XAxis dataKey="kpi" tick={{ fontSize: 10, fill: '#5b6676' }} interval={0} /><YAxis tick={{ fontSize: 11, fill: '#5b6676' }} width={36} /><Tooltip /><Bar dataKey="achievement" name="Achievement %" fill="#2563eb" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></Section></div>
        </>
      )}
    </>
  );
}
