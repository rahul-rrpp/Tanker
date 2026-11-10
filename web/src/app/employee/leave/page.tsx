'use client';

import { useState } from 'react';
import { FormModal } from '@/components/employee/kit';
import { ActionButton, DataTable } from '@/components/transporter/ui';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, StatCard } from '@/components/ui/kit';
import { Badge, Button } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dayOnly, humanize } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { CalendarDays } from 'lucide-react';

type L = { id: string; leaveType: string; startDate: string; endDate: string; days: string; reason: string; status: string; decisionNote: string | null };
type Data = { items: L[]; balances: { leaveType: string; name: string; entitled: number; used: number; available: number }[] };

export default function Page() {
  const { data, error, mutate } = useApi<Data>('/employee/leaves');
  const [open, setOpen] = useState(false);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  return (
    <>
      <PageHeader title="Leave management" actions={<Button onClick={() => setOpen(true)}>Apply for leave</Button>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">{data.balances.map((b) => <StatCard key={b.leaveType} label={b.name} value={b.available} hint={`${b.used} used of ${b.entitled}`} icon={<CalendarDays className="h-5 w-5" />} />)}</div>
      {data.items.length === 0 ? <EmptyState title="No applications" /> : <DataTable rows={data.items} rowKey={(l) => l.id} columns={[{ key: 't', label: 'Type', render: (l) => humanize(l.leaveType) }, { key: 'f', label: 'From', render: (l) => dayOnly(l.startDate) }, { key: 'to', label: 'To', render: (l) => dayOnly(l.endDate) }, { key: 'd', label: 'Days', render: (l) => Number(l.days) }, { key: 'r', label: 'Reason', render: (l) => l.reason }, { key: 's', label: 'Status', render: (l) => <Badge tone={l.status === 'APPROVED' ? 'success' : l.status === 'REJECTED' ? 'danger' : l.status === 'PENDING' ? 'warning' : 'neutral'}>{humanize(l.status)}</Badge> }, { key: 'n', label: 'Note', render: (l) => l.decisionNote ?? '—' }, { key: 'a', label: '', render: (l) => (l.status === 'PENDING' ? <ActionButton action={() => api.post(`/employee/leaves/${l.id}/cancel`, {})} success="Cancelled" onDone={() => void mutate()}>Cancel</ActionButton> : null) }]} />}
      <FormModal open={open} onClose={() => setOpen(false)} title="Apply for leave" submit="Apply" fields={[{ name: 'leaveType', label: 'Leave type', type: 'select', options: data.balances.map((b) => ({ value: b.leaveType, label: `${b.name} (${b.available} left)` })), required: true }, { name: 'startDate', label: 'From', type: 'date', required: true }, { name: 'endDate', label: 'To', type: 'date', required: true }, { name: 'reason', label: 'Reason', type: 'textarea', required: true }]} onSubmit={async (v) => { const f = new FormData(); Object.entries(v).forEach(([k, x]) => f.append(k, x)); await api.post('/employee/leaves', f); void mutate(); }} />
    </>
  );
}
