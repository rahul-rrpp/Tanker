'use client';

import { useState } from 'react';
import { FormModal, Section } from '@/components/employee/kit';
import { ActionButton, DataTable, FileLinks } from '@/components/transporter/ui';
import { EmptyState, PageHeader } from '@/components/ui/kit';
import { Badge, Button, TextField } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateTimeIST, dayOnly, humanize, todayIST } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type L = { id: string; leaveType: string; startDate: string; endDate: string; days: string; reason: string; fileName: string | null; employee: { employeeCode: string; user: { fullName: string } } };
type Att = { id: string; name: string; employeeCode: string; date: string; checkInAt: string | null; checkOutAt: string | null; hours: number | null; status: string };
type Mis = { date: string; submitted: { id: string; name: string; employeeCode: string; reportType: string; submittedAt: string; revision: number; data: Record<string, unknown> }[]; missing: { id: string; name: string; employeeCode: string }[]; totals: Record<string, number>; canRevise: boolean };
type Team = { items: { id: string; code: string; name: string; role: string; score: number; rating: string }[] };

export default function Page() {
  const [date, setDate] = useState(todayIST());
  const leave = useApi<{ items: L[] }>('/employee/leaves/approvals', { shouldRetryOnError: false });
  const att = useApi<{ items: Att[] }>(`/employee/attendance/team?from=${date}&to=${date}`, { shouldRetryOnError: false });
  const mis = useApi<Mis>(`/employee/mis-team?from=${date}`, { shouldRetryOnError: false });
  const team = useApi<Team>('/employee/performance/team', { shouldRetryOnError: false });
  const [reject, setReject] = useState<L | null>(null);
  const [revise, setRevise] = useState<Mis['submitted'][number] | null>(null);
  const nothing = !leave.data?.items.length && att.error && mis.error && team.error;
  return (
    <>
      <PageHeader title="Team & approvals" subtitle="Your direct reports, or everyone if HR or MIS access applies" actions={<div className="w-44"><TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>} />
      {nothing && <EmptyState title="No team items">Direct reports and approvals appear here.</EmptyState>}
      <div className="space-y-5">
        {Boolean(leave.data?.items.length) && <Section title="Leave approvals"><DataTable rows={leave.data!.items} rowKey={(l) => l.id} columns={[{ key: 'e', label: 'Employee', render: (l) => l.employee.user.fullName }, { key: 't', label: 'Type', render: (l) => humanize(l.leaveType) }, { key: 'd', label: 'Dates', render: (l) => `${dayOnly(l.startDate)} to ${dayOnly(l.endDate)}` }, { key: 'n', label: 'Days', render: (l) => Number(l.days) }, { key: 'r', label: 'Reason', render: (l) => l.reason }, { key: 'a', label: '', render: (l) => <span className="flex flex-wrap items-center gap-1">{l.fileName && <FileLinks path={`/employee/leaves/${l.id}/file`} />}<ActionButton variant="primary" action={() => api.post(`/employee/leaves/${l.id}/approve`, {})} success="Approved" onDone={() => void leave.mutate()}>Approve</ActionButton><Button size="sm" variant="danger" onClick={() => setReject(l)}>Reject</Button></span> }]} /></Section>}
        {mis.data && <Section title={`Daily MIS: ${mis.data.submitted.length} submitted, ${mis.data.missing.length} missing`}>
          {mis.data.missing.length > 0 && <p className="mb-3 text-sm text-red-700">Missing: {mis.data.missing.map((m) => m.name).join(', ')}</p>}
          {Object.keys(mis.data.totals).length > 0 && <p className="mb-3 text-sm text-muted">{Object.entries(mis.data.totals).map(([k, v]) => `${humanize(k.replace(/([A-Z])/g, '_$1'))}: ${v}`).join(' · ')}</p>}
          {mis.data.submitted.length > 0 && <DataTable rows={mis.data.submitted} rowKey={(r) => r.id} columns={[{ key: 'n', label: 'Employee', render: (r) => r.name }, { key: 't', label: 'Report', render: (r) => humanize(r.reportType) }, { key: 's', label: 'Submitted', render: (r) => dateTimeIST(r.submittedAt) }, { key: 'r', label: 'Revision', render: (r) => r.revision }, { key: 'd', label: 'Data', render: (r) => <span className="text-xs">{Object.entries(r.data).map(([k, v]) => `${k}: ${String(v)}`).join(', ').slice(0, 160)}</span> }, { key: 'a', label: '', render: (r) => (mis.data!.canRevise ? <Button size="sm" variant="secondary" onClick={() => setRevise(r)}>Revise</Button> : null) }]} />}
        </Section>}
        {att.data && <Section title="Attendance">{att.data.items.length === 0 ? <p className="text-sm text-muted">No records for this date.</p> : <DataTable rows={att.data.items} rowKey={(a) => a.id} columns={[{ key: 'n', label: 'Employee', render: (a) => `${a.name} (${a.employeeCode})` }, { key: 'i', label: 'In', render: (a) => dateTimeIST(a.checkInAt) }, { key: 'o', label: 'Out', render: (a) => dateTimeIST(a.checkOutAt) }, { key: 'h', label: 'Hours', render: (a) => a.hours ?? '—' }, { key: 's', label: 'Status', render: (a) => <Badge>{humanize(a.status)}</Badge> }]} />}</Section>}
        {team.data && <Section title="Performance ranking"><DataTable rows={team.data.items} rowKey={(x) => x.id} columns={[{ key: 'r', label: '#', render: (x) => team.data!.items.indexOf(x) + 1 }, { key: 'n', label: 'Employee', render: (x) => `${x.name} (${x.code})` }, { key: 'ro', label: 'Role', render: (x) => x.role }, { key: 's', label: 'Score', render: (x) => x.score }, { key: 'ra', label: 'Rating', render: (x) => x.rating }]} /></Section>}
      </div>
      <FormModal open={Boolean(reject)} onClose={() => setReject(null)} title="Reject leave" submit="Reject" fields={[{ name: 'note', label: 'Reason', type: 'textarea', required: true }]} onSubmit={async (v) => { await api.post(`/employee/leaves/${reject!.id}/reject`, v); void leave.mutate(); }} />
      <FormModal open={Boolean(revise)} onClose={() => setRevise(null)} title="Revise report" submit="Save revision" fields={[{ name: 'data', label: 'Report data (JSON)', type: 'textarea', required: true, initial: JSON.stringify(revise?.data ?? {}, null, 1) }, { name: 'reason', label: 'Reason for revision', required: true }]} onSubmit={async (v) => { await api.put(`/employee/mis/${revise!.id}`, { data: JSON.parse(v.data), reason: v.reason }); void mis.mutate(); }} />
    </>
  );
}
