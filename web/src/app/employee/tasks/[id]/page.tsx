'use client';

import { use, useState } from 'react';
import { FormModal, opts, Section, useCan } from '@/components/employee/kit';
import { FileLinks } from '@/components/transporter/ui';
import { ErrorBlock, KV, LoadingBlock, PageHeader, useToast } from '@/components/ui/kit';
import { Badge, Button } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateTimeIST, humanize } from '@/lib/format';
import { useApi } from '@/lib/useApi';

const LABEL = { OPEN: 'New', IN_PROGRESS: 'In progress', PENDING: 'Pending', ON_HOLD: 'On hold', DONE: 'Completed', CANCELLED: 'Cancelled' };
type Data = { task: { id: string; taskCode: string; title: string; description: string | null; priority: string; status: keyof typeof LABEL; dueAt: string | null; completionRemarks: string | null; assignee: { user: { fullName: string } } }; activities: { id: string; type: string; message: string | null; fromValue: string | null; toValue: string | null; fileName: string | null; hasFile: boolean; createdAt: string }[] };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const toast = useToast();
  const { data, error, mutate } = useApi<Data>(`/employee/tasks/${id}`);
  const { data: dir } = useApi<{ employees: { id: string; label: string }[] }>('/employee/directory', { revalidateOnFocus: false });
  const [m, setM] = useState<'status' | 'remark' | 'transfer' | null>(null);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  const t = data.task;
  const attach = async (f?: File) => {
    if (!f) return;
    const form = new FormData();
    form.append('file', f);
    try {
      await api.post(`/employee/tasks/${id}/attachments`, form);
      void mutate();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <>
      <PageHeader title={t.title} subtitle={t.taskCode} back={{ href: '/employee/tasks', label: 'Tasks' }} actions={<><Badge tone={t.status === 'DONE' ? 'success' : 'warning'}>{LABEL[t.status]}</Badge><Button size="sm" onClick={() => setM('status')}>Update status</Button><Button size="sm" variant="secondary" onClick={() => setM('remark')}>Add remark</Button>{can('tasks.assign') && <Button size="sm" variant="secondary" onClick={() => setM('transfer')}>Transfer</Button>}</>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Details"><dl className="divide-y divide-line"><KV label="Assigned to">{t.assignee.user.fullName}</KV><KV label="Priority">{humanize(t.priority)}</KV><KV label="Due">{dateTimeIST(t.dueAt)}</KV><KV label="Description">{t.description}</KV><KV label="Completion remarks">{t.completionRemarks}</KV></dl><label className="mt-3 block text-sm font-medium text-ink">Attach document<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="mt-1 block w-full text-sm" onChange={(e) => void attach(e.target.files?.[0])} /></label></Section>
        <Section title="History"><ol className="space-y-2 text-sm">{data.activities.map((a) => <li key={a.id}><strong>{humanize(a.type)}</strong>{a.toValue ? ` → ${LABEL[a.toValue as keyof typeof LABEL] ?? a.toValue}` : ''}{a.message ? ` · ${a.message}` : ''}{a.fileName ? ` · ${a.fileName}` : ''}{a.hasFile && <FileLinks path={`/employee/tasks/${id}/attachments/${a.id}`} />}<span className="block text-xs text-muted">{dateTimeIST(a.createdAt)}</span></li>)}</ol></Section>
      </div>
      <FormModal open={m === 'status'} onClose={() => setM(null)} title="Update status" submit="Save" fields={[{ name: 'status', label: 'Status', type: 'select', options: opts(LABEL), required: true, initial: t.status }, { name: 'completionRemarks', label: 'Remarks (needed to complete)', type: 'textarea' }]} onSubmit={async (v) => { await api.put(`/employee/tasks/${id}`, v.completionRemarks ? v : { status: v.status }); void mutate(); }} />
      <FormModal open={m === 'remark'} onClose={() => setM(null)} title="Add remark" submit="Save" fields={[{ name: 'message', label: 'Remark', type: 'textarea', required: true }]} onSubmit={async (v) => { await api.post(`/employee/tasks/${id}/remarks`, v); void mutate(); }} />
      <FormModal open={m === 'transfer'} onClose={() => setM(null)} title="Transfer task" submit="Transfer" fields={[{ name: 'assigneeId', label: 'Employee', type: 'select', options: dir?.employees.map((e) => ({ value: e.id, label: e.label })) ?? [], required: true }, { name: 'reason', label: 'Reason' }]} onSubmit={async (v) => { await api.post(`/employee/tasks/${id}/transfer`, v.reason ? v : { assigneeId: v.assigneeId }); void mutate(); }} />
    </>
  );
}
