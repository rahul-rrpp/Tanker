'use client';

import Link from 'next/link';
import { useState } from 'react';
import { FormModal, ListPage, opts, useCan } from '@/components/employee/kit';
import { TicketStatusBadge } from '@/components/portal/bits';
import { Button } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateTimeIST, humanize } from '@/lib/format';
import type { Paged } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

type T = { id: string; ticketNumber: string; category: string; subject: string; priority: string; status: string; createdAt: string; company: { name: string } | null; transporter: { companyName: string } | null; booking: { bookingCode: string } | null };
const CATS = { BOOKING_ISSUE: 'Booking issue', TRANSPORTER_ISSUE: 'Transporter issue', DRIVER_ISSUE: 'Driver issue', FREIGHT_DISPUTE: 'Freight dispute', LOADING_PROBLEM: 'Loading problem', DELIVERY_PROBLEM: 'Delivery problem', PAYMENT_PROBLEM: 'Payment issue', TECHNICAL_SUPPORT: 'Technical issue' };

export default function Page() {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const { data: cos } = useApi<Paged<{ id: string; name: string; companyCode: string }>>(can('companies.view') ? '/employee/companies?pageSize=200' : null);
  return (
    <>
      <ListPage<T> title="Customer support" path="/employee/support/tickets" refreshKey={key} tabs={[{ value: '', label: 'All' }, { value: 'OPEN', label: 'Open' }, { value: 'ASSIGNED', label: 'Assigned' }, { value: 'UNDER_REVIEW', label: 'Under review' }, { value: 'AWAITING_RESPONSE', label: 'Awaiting response' }, { value: 'RESOLVED', label: 'Resolved' }, { value: 'CLOSED', label: 'Closed' }]} tabParam="status" rowKey={(t) => t.id} actions={can('complaints.edit') && can('companies.view') ? <Button onClick={() => setOpen(true)}>Create ticket</Button> : undefined} columns={[{ key: 'n', label: 'Ticket', render: (t) => <Link className="font-semibold text-brand-600" href={`/employee/support/${t.id}`}>{t.ticketNumber}</Link> }, { key: 'w', label: 'Raised for', render: (t) => t.company?.name ?? t.transporter?.companyName ?? '—' }, { key: 'b', label: 'Booking', render: (t) => t.booking?.bookingCode ?? '—' }, { key: 'c', label: 'Category', render: (t) => humanize(t.category) }, { key: 's', label: 'Subject', render: (t) => t.subject }, { key: 'p', label: 'Priority', render: (t) => humanize(t.priority) }, { key: 'st', label: 'Status', render: (t) => <TicketStatusBadge status={t.status} /> }, { key: 'd', label: 'Created', render: (t) => dateTimeIST(t.createdAt) }]} />
      <FormModal open={open} onClose={() => setOpen(false)} title="Create ticket" submit="Create" fields={[{ name: 'companyId', label: 'Company', type: 'select', options: cos?.items.map((c) => ({ value: c.id, label: `${c.name} (${c.companyCode})` })) ?? [], required: true }, { name: 'category', label: 'Category', type: 'select', options: opts(CATS), required: true }, { name: 'priority', label: 'Priority', type: 'select', options: opts({ LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' }), initial: 'MEDIUM', required: true }, { name: 'subject', label: 'Subject', required: true }, { name: 'description', label: 'Description', type: 'textarea', required: true }]} onSubmit={async (v) => { const f = new FormData(); Object.entries(v).forEach(([k, x]) => f.append(k, x)); await api.post('/employee/support/tickets', f); setKey((k) => k + 1); }} />
    </>
  );
}
