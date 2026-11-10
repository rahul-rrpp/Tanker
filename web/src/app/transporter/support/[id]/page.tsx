'use client';

import { use, useState } from 'react';
import { TicketStatusBadge } from '@/components/portal/bits';
import { FileLinks, PromptModal } from '@/components/transporter/ui';
import { ErrorBlock, KV, LoadingBlock, PageHeader, SectionTitle, TextArea, useToast } from '@/components/ui/kit';
import { Alert, Button, Card } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateTimeIST, humanize } from '@/lib/format';
import { TICKET_CATEGORY_OPTIONS } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

type T = { ticket: { id: string; ticketNumber: string; subject: string; description: string; category: string; priority: string; status: string; resolutionNote: string | null; createdAt: string; booking: { bookingCode: string } | null; attachments: { id: string; fileName: string }[]; activities: { id: string; type: string; message: string | null; createdAt: string }[] } };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const { data, error, mutate } = useApi<T>(`/support/tickets/${id}`);
  const [reply, setReply] = useState('');
  const [reopen, setReopen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  const t = data.ticket;
  const send = async () => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('message', reply.trim());
      await api.post(`/support/tickets/${id}/replies`, form);
      setReply('');
      void mutate();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title={t.subject} subtitle={t.ticketNumber} back={{ href: '/transporter/support', label: 'Support' }} actions={<><TicketStatusBadge status={t.status} />{(t.status === 'RESOLVED' || t.status === 'CLOSED') && <Button size="sm" variant="secondary" onClick={() => setReopen(true)}>Reopen</Button>}</>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {t.resolutionNote && <Alert tone="success" title="Resolution">{t.resolutionNote}</Alert>}
          <Card className="p-5"><p className="whitespace-pre-wrap text-sm">{t.description}</p></Card>
          <Card className="p-5">
            <SectionTitle>Conversation</SectionTitle>
            {t.activities.length === 0 ? <p className="text-sm text-muted">No replies yet.</p> : <ol className="space-y-3">{t.activities.map((a) => <li key={a.id} className="text-sm"><p className="whitespace-pre-wrap">{a.message ?? humanize(a.type)}</p><p className="text-xs text-muted">{dateTimeIST(a.createdAt)}</p></li>)}</ol>}
            {t.status !== 'CLOSED' && <div className="mt-4 space-y-2"><TextArea label="Add reply" value={reply} onChange={(e) => setReply(e.target.value)} /><Button size="sm" loading={busy} disabled={busy || reply.trim().length < 2} onClick={() => void send()}>Send</Button></div>}
          </Card>
        </div>
        <Card className="p-5"><dl className="divide-y divide-line"><KV label="Category">{TICKET_CATEGORY_OPTIONS[t.category] ?? t.category}</KV><KV label="Priority">{t.priority.toLowerCase()}</KV><KV label="Booking">{t.booking?.bookingCode}</KV><KV label="Created">{dateTimeIST(t.createdAt)}</KV></dl>
          {t.attachments.length > 0 && <ul className="mt-3 space-y-1 text-sm">{t.attachments.map((a) => <li key={a.id} className="flex flex-col"><span className="truncate">{a.fileName}</span><FileLinks path={`/support/tickets/${id}/attachments/${a.id}`} /></li>)}</ul>}
        </Card>
      </div>
      <PromptModal open={reopen} onClose={() => setReopen(false)} title="Reopen ticket" label="Why does this need reopening?" submit="Reopen" multiline onSubmit={async (reason) => { await api.post(`/support/tickets/${id}/reopen`, { reason }); toast.success('Ticket reopened'); void mutate(); }} />
    </>
  );
}
