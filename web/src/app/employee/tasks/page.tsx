'use client';

import Link from 'next/link';
import { useState } from 'react';
import { clean, FormModal, iso, ListPage, opts } from '@/components/employee/kit';
import { Badge, Button } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateTimeIST, humanize } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type T = { id: string; taskCode: string; title: string; priority: string; status: string; dueAt: string | null; assignee: { user: { fullName: string } } };
type F = { id: string; dueAt: string; followUpType: string; status: string; lead: { id: string; leadCode: string; name: string; phone: string } };

const TASK_LABEL: Record<string, string> = { OPEN: 'New', IN_PROGRESS: 'In progress', PENDING: 'Pending', ON_HOLD: 'On hold', DONE: 'Completed', CANCELLED: 'Cancelled' };
const TABS = [['', 'My tasks'], ['today', 'Today'], ['overdue', 'Overdue'], ['upcoming', 'Upcoming'], ['completed', 'Completed']].map(([value, label]) => ({ value, label }));
const OUTCOME = { CONNECTED: 'Connected', NOT_CONNECTED: 'Not connected', BUSY: 'Busy', SWITCHED_OFF: 'Switched off', INTERESTED: 'Interested', NOT_INTERESTED: 'Not interested', CALLBACK_REQUESTED: 'Callback requested', MEETING_FIXED: 'Meeting fixed', REGISTRATION_PROMISED: 'Registration promised' };

export default function Page() {
  const { data: dir } = useApi<{ employees: { id: string; label: string }[] }>('/employee/directory', { revalidateOnFocus: false });
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const [done, setDone] = useState<F | null>(null);
  const [moved, setMoved] = useState<F | null>(null);
  const can = dir && dir.employees.length > 0;
  return (
    <>
      <ListPage<T> title="Tasks" path="/employee/tasks" tabs={TABS} refreshKey={key} rowKey={(t) => t.id} actions={<Button onClick={() => setOpen(true)}>Create task</Button>} columns={[{ key: 'c', label: 'Task', render: (t) => <Link className="font-semibold text-brand-600" href={`/employee/tasks/${t.id}`}>{t.taskCode}</Link> }, { key: 't', label: 'Title', render: (t) => t.title }, { key: 'a', label: 'Assigned to', render: (t) => t.assignee.user.fullName }, { key: 'p', label: 'Priority', render: (t) => humanize(t.priority) }, { key: 'd', label: 'Due', render: (t) => dateTimeIST(t.dueAt) }, { key: 's', label: 'Status', render: (t) => <Badge tone={t.status === 'DONE' ? 'success' : t.status === 'CANCELLED' ? 'danger' : 'warning'}>{TASK_LABEL[t.status]}</Badge> }]} />
      <div className="mt-10">
        <ListPage<F> title="Lead follow-ups" path="/employee/follow-ups" tabs={TABS.map((t) => (t.value === '' ? { ...t, label: 'All' } : t))} refreshKey={key} rowKey={(f) => f.id} columns={[{ key: 'l', label: 'Lead', render: (f) => <Link className="font-semibold text-brand-600" href={`/employee/leads/${f.lead.id}`}>{f.lead.leadCode}</Link> }, { key: 'n', label: 'Name', render: (f) => f.lead.name }, { key: 'p', label: 'Mobile', render: (f) => f.lead.phone }, { key: 't', label: 'Type', render: (f) => humanize(f.followUpType) }, { key: 'd', label: 'Due', render: (f) => dateTimeIST(f.dueAt) }, { key: 'a', label: '', render: (f) => (f.status === 'PENDING' ? <span className="flex gap-1"><Button size="sm" onClick={() => setDone(f)}>Complete</Button><Button size="sm" variant="secondary" onClick={() => setMoved(f)}>Reschedule</Button></span> : humanize(f.status)) }]} />
      </div>
      <FormModal open={open} onClose={() => setOpen(false)} title="Create task" submit="Create" fields={[{ name: 'title', label: 'Title', required: true }, ...(can ? [{ name: 'assigneeId', label: 'Assign to (blank = me)', type: 'select' as const, options: dir.employees.map((e) => ({ value: e.id, label: e.label })) }] : []), { name: 'priority', label: 'Priority', type: 'select', options: opts({ LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' }), initial: 'MEDIUM', required: true }, { name: 'startAt', label: 'Start', type: 'datetime-local' }, { name: 'dueAt', label: 'Due', type: 'datetime-local' }, { name: 'reminderAt', label: 'Reminder', type: 'datetime-local' }, { name: 'description', label: 'Description', type: 'textarea' }]} onSubmit={async (v) => { const b = clean(v); for (const k of ['startAt', 'dueAt', 'reminderAt']) if (b[k]) b[k] = iso(b[k]); await api.post('/employee/tasks', b); setKey((k) => k + 1); }} />
      <FormModal open={Boolean(done)} onClose={() => setDone(null)} title="Complete follow-up" submit="Complete" fields={[{ name: 'callOutcome', label: 'Outcome', type: 'select', options: opts(OUTCOME), required: true }, { name: 'nextDueAt', label: 'Next follow-up', type: 'datetime-local' }, { name: 'remarks', label: 'Remarks', type: 'textarea' }]} onSubmit={async (v) => { const b = clean(v); if (b.nextDueAt) b.nextDueAt = iso(b.nextDueAt); await api.post(`/employee/follow-ups/${done!.id}/complete`, b); setKey((k) => k + 1); }} />
      <FormModal open={Boolean(moved)} onClose={() => setMoved(null)} title="Reschedule" submit="Save" fields={[{ name: 'dueAt', label: 'New date and time', type: 'datetime-local', required: true }]} onSubmit={async (v) => { await api.post(`/employee/follow-ups/${moved!.id}/reschedule`, { dueAt: iso(v.dueAt) }); setKey((k) => k + 1); }} />
    </>
  );
}
