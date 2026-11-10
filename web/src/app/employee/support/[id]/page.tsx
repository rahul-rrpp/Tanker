'use client';

import { use, useState } from 'react';
import { FormModal, opts, Section, useCan } from '@/components/employee/kit';
import { TicketStatusBadge } from '@/components/portal/bits';
import { FileLinks } from '@/components/transporter/ui';
import { ErrorBlock, KV, LoadingBlock, PageHeader, useToast } from '@/components/ui/kit';
import { Badge, Button } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateTimeIST, humanize } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type Data = { ticket: { id: string; ticketNumber: string; subject: string; description: string; category: string; priority: string; status: string; resolutionNote: string | null; company: { name: string; contactPhone: string } | null; transporter: { companyName: string } | null; booking: { bookingCode: string } | null; attachments: { id: string; fileName: string }[]; activities: { id: string; type: string; message: string | null; internal: boolean; createdAt: string }[] } };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const toast = useToast();
  const { data, error, mutate } = useApi<Data>(`/employee/support/tickets/${id}`);
  const { data: dir } = useApi<{ employees: { id: string; label: string }[] }>('/employee/directory', { revalidateOnFocus: false });
  const [m, setM] = useState<'reply' | 'assign' | null>(null);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  const t = data.ticket;
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const f = new FormData();
    [...files].slice(0, 5).forEach((x) => f.append('attachments', x));
    try {
      await api.post(`/employee/support/tickets/${id}/attachments`, f);
      void mutate();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <>
      <PageHeader title={t.subject} subtitle={t.ticketNumber} back={{ href: '/employee/support', label: 'Support' }} actions={<><TicketStatusBadge status={t.status} />{can('complaints.edit') && t.status !== 'CLOSED' && <Button size="sm" onClick={() => setM('reply')}>Reply / update</Button>}{can('complaints.assign') && <Button size="sm" variant="secondary" onClick={() => setM('assign')}>Assign</Button>}</>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Section title="Description"><p className="whitespace-pre-wrap text-sm">{t.description}</p></Section>
          <Section title="Activity">{t.activities.length === 0 ? <p className="text-sm text-muted">No activity yet.</p> : <ol className="space-y-2 text-sm">{t.activities.map((a) => <li key={a.id}>{a.internal && <Badge className="mr-1">Internal</Badge>}{a.message ?? humanize(a.type)}<span className="block text-xs text-muted">{dateTimeIST(a.createdAt)}</span></li>)}</ol>}</Section>
        </div>
        <Section title="Details"><dl className="divide-y divide-line"><KV label="For">{t.company?.name ?? t.transporter?.companyName}</KV><KV label="Booking">{t.booking?.bookingCode}</KV><KV label="Category">{humanize(t.category)}</KV><KV label="Priority">{humanize(t.priority)}</KV><KV label="Resolution">{t.resolutionNote}</KV></dl>
          <ul className="mt-3 text-sm">{t.attachments.map((a) => <li key={a.id} className="flex flex-col"><span className="truncate">{a.fileName}</span><FileLinks path={`/employee/support/tickets/${id}/attachments/${a.id}`} /></li>)}</ul>
          {can('complaints.edit') && <label className="mt-3 block text-sm font-medium text-ink">Upload documents<input type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" className="mt-1 block w-full text-sm" onChange={(e) => void upload(e.target.files)} /></label>}
        </Section>
      </div>
      <FormModal open={m === 'reply'} onClose={() => setM(null)} title="Reply or update" submit="Send" fields={[{ name: 'message', label: 'Message', type: 'textarea', required: true }, { name: 'visibility', label: 'Visibility', type: 'select', options: opts({ PUBLIC: 'Reply to customer', INTERNAL: 'Internal note' }), initial: 'PUBLIC', required: true }, { name: 'status', label: 'Set status', type: 'select', options: opts({ UNDER_REVIEW: 'Under review', AWAITING_RESPONSE: 'Awaiting response', RESOLVED: 'Resolved', CLOSED: 'Closed' }) }, { name: 'escalate', label: 'Escalate', type: 'select', options: opts({ NO: 'No', YES: 'Yes, mark urgent' }), initial: 'NO' }]} onSubmit={async (v) => { await api.post(`/employee/support/tickets/${id}/respond`, { message: v.message, internal: v.visibility === 'INTERNAL', escalate: v.escalate === 'YES', ...(v.status ? { status: v.status } : {}) }); void mutate(); }} />
      <FormModal open={m === 'assign'} onClose={() => setM(null)} title="Assign ticket" submit="Assign" fields={[{ name: 'employeeId', label: 'Employee', type: 'select', options: dir?.employees.map((e) => ({ value: e.id, label: e.label })) ?? [], required: true }]} onSubmit={async (v) => { await api.post(`/employee/support/tickets/${id}/assign`, v); void mutate(); }} />
    </>
  );
}
