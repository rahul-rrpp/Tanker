'use client';

import { use, useState } from 'react';
import { FormModal, Section, useCan } from '@/components/employee/kit';
import { ErrorBlock, KV, LoadingBlock, PageHeader, StatusBadge } from '@/components/ui/kit';
import { Button } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateTimeIST, humanize, inr } from '@/lib/format';
import { OFFER_STATUS } from '@/lib/status';
import { useApi } from '@/lib/useApi';

type Data = { offer: { id: string; status: string; currentAmount: string; expiresAt: string; transporter: { companyName: string; owner: { phone: string } }; booking: { bookingCode: string; customerOffer: string; company: { name: string; contactPhone: string } }; history: { id: string; party: string; action: string; amount: string | null; message: string | null; createdAt: string }[] }; notes: { id: string; note: string; author: string; createdAt: string }[] };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const { data, error, mutate } = useApi<Data>(`/employee/negotiations/${id}`);
  const [m, setM] = useState<'note' | 'notify' | 'dispute' | null>(null);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  const o = data.offer;
  return (
    <>
      <PageHeader title={`Negotiation: ${o.booking.bookingCode}`} subtitle={`${o.booking.company.name} and ${o.transporter.companyName}`} back={{ href: '/employee/negotiations', label: 'Negotiations' }} actions={<><StatusBadge map={OFFER_STATUS} value={o.status} />{can('offers.edit') && <><Button size="sm" variant="secondary" onClick={() => setM('note')}>Internal note</Button><Button size="sm" variant="secondary" onClick={() => setM('notify')}>Notify parties</Button><Button size="sm" variant="secondary" onClick={() => setM('dispute')}>Flag dispute</Button></>}</>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="History"><ol className="space-y-2 text-sm">{o.history.map((h) => <li key={h.id}><strong>{humanize(h.party)}</strong> · {humanize(h.action)}{h.amount ? ` · ${inr(h.amount)}` : ''}{h.message ? ` · ${h.message}` : ''}<span className="block text-xs text-muted">{dateTimeIST(h.createdAt)}</span></li>)}</ol></Section>
        <div className="space-y-5"><Section title="Current"><dl className="divide-y divide-line"><KV label="Customer offer">{inr(o.booking.customerOffer)}</KV><KV label="Latest">{inr(o.currentAmount)}</KV><KV label="Expiry">{dateTimeIST(o.expiresAt)}</KV><KV label="Company">{o.booking.company.contactPhone}</KV><KV label="Transporter">{o.transporter.owner.phone}</KV></dl></Section>
          <Section title="Internal notes">{data.notes.length === 0 ? <p className="text-sm text-muted">None.</p> : <ul className="space-y-1 text-sm">{data.notes.map((n) => <li key={n.id}>{n.note}<span className="block text-xs text-muted">{n.author} · {dateTimeIST(n.createdAt)}</span></li>)}</ul>}</Section></div>
      </div>
      <FormModal open={m === 'note'} onClose={() => setM(null)} title="Internal note" submit="Save" fields={[{ name: 'note', label: 'Note', type: 'textarea', required: true }]} onSubmit={async (v) => { await api.post(`/employee/negotiations/${id}/notes`, v); void mutate(); }} />
      <FormModal open={m === 'notify'} onClose={() => setM(null)} title="Notify both parties" submit="Send" fields={[{ name: 'message', label: 'Message', type: 'textarea', required: true }]} onSubmit={async (v) => { await api.post(`/employee/negotiations/${id}/notify`, v); }} />
      <FormModal open={m === 'dispute'} onClose={() => setM(null)} title="Flag dispute" submit="Flag" fields={[{ name: 'subject', label: 'Subject', required: true }, { name: 'description', label: 'Description', type: 'textarea', required: true }]} onSubmit={async (v) => { await api.post(`/employee/negotiations/${id}/flag-dispute`, v); }} />
    </>
  );
}
