'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { clean, FormModal, iso, ListPage, opts, useCan, type Field } from '@/components/employee/kit';
import { Badge, Button } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateTimeIST, humanize } from '@/lib/format';

export const LEAD_SOURCE = { FIELD_VISIT: 'Field visit', TELECALLING: 'Telecalling', WEBSITE: 'Website', GOOGLE: 'Google', SOCIAL_MEDIA: 'Social media', REFERRAL: 'Referral', EXHIBITION: 'Exhibition', EXISTING_CUSTOMER: 'Existing customer', EMPLOYEE_REFERENCE: 'Employee reference', OTHER: 'Other' };
export const LEAD_TYPE = { COMPANY: 'Company', TRANSPORTER: 'Transporter', DRIVER: 'Driver' };
export const PRIORITY = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' };
const STATUS_TABS = [['', 'All'], ['NEW', 'New'], ['INTERESTED', 'Interested'], ['FOLLOW_UP', 'Follow-up'], ['REGISTERED', 'Registered'], ['VERIFIED', 'Verified'], ['LOST', 'Lost']].map(([value, label]) => ({ value, label }));

type L = { id: string; leadCode: string; leadType: string; name: string; phone: string; city: string | null; priority: string; status: string; nextFollowUpAt: string | null; owner: string | null };

const FIELDS: Field[] = [
  { name: 'leadType', label: 'Lead category', type: 'select', options: opts(LEAD_TYPE), required: true },
  { name: 'name', label: 'Business / person name', required: true },
  { name: 'contactPerson', label: 'Contact person' },
  { name: 'phone', label: 'Mobile number', required: true },
  { name: 'whatsapp', label: 'WhatsApp number' },
  { name: 'email', label: 'Email' },
  { name: 'businessType', label: 'Business type' },
  { name: 'gstNumber', label: 'GST number' },
  { name: 'city', label: 'City' },
  { name: 'state', label: 'State' },
  { name: 'address', label: 'Address' },
  { name: 'source', label: 'Lead source', type: 'select', options: opts(LEAD_SOURCE), required: true },
  { name: 'priority', label: 'Priority', type: 'select', options: opts(PRIORITY), initial: 'MEDIUM' },
  { name: 'nextFollowUpAt', label: 'Next follow-up', type: 'datetime-local' },
  { name: 'remarks', label: 'Remarks', type: 'textarea' },
];

export function LeadList({ mine }: { mine: boolean }) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <ListPage<L> title={mine ? 'My leads' : 'Lead management'} path={`/employee/leads${mine ? '?mine=1' : ''}`} tabs={STATUS_TABS} tabParam="status" refreshKey={key} exportable={!mine && can('leads.export')} rowKey={(l) => l.id}
        actions={can('leads.create') ? <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden /> Add lead</Button> : undefined}
        columns={[
          { key: 'c', label: 'Lead ID', render: (l) => <Link className="font-semibold text-brand-600" href={`/employee/leads/${l.id}`}>{l.leadCode}</Link> }, { key: 't', label: 'Category', render: (l) => humanize(l.leadType) }, { key: 'n', label: 'Name', render: (l) => l.name }, { key: 'p', label: 'Mobile', render: (l) => l.phone }, { key: 'ci', label: 'City', render: (l) => l.city ?? '—' },
          { key: 'pr', label: 'Priority', render: (l) => <Badge tone={l.priority === 'HIGH' ? 'danger' : l.priority === 'MEDIUM' ? 'warning' : 'neutral'}>{humanize(l.priority)}</Badge> }, { key: 's', label: 'Status', render: (l) => <Badge tone={['LOST', 'NOT_INTERESTED'].includes(l.status) ? 'danger' : ['VERIFIED', 'ACTIVE', 'REGISTERED'].includes(l.status) ? 'success' : 'info'}>{humanize(l.status)}</Badge> }, { key: 'f', label: 'Next follow-up', render: (l) => dateTimeIST(l.nextFollowUpAt) }, { key: 'o', label: 'Assigned', render: (l) => l.owner ?? '—' },
        ]} />
      <FormModal open={open} onClose={() => setOpen(false)} title="Add lead" submit="Save lead" fields={FIELDS} onSubmit={async (v) => { const b = clean(v); if (b.nextFollowUpAt) b.nextFollowUpAt = iso(b.nextFollowUpAt); await api.post('/employee/leads', b); setKey((k) => k + 1); }} />
    </>
  );
}
