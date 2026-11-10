'use client';

import { use, useState } from 'react';
import { clean, FormModal, iso, opts, Section, useCan, type Field } from '@/components/employee/kit';
import { DocumentUpload, FileLinks } from '@/components/transporter/ui';
import { ErrorBlock, KV, LoadingBlock, PageHeader } from '@/components/ui/kit';
import { Badge, Button } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateTimeIST, humanize } from '@/lib/format';
import { INDIAN_STATES } from '@/lib/status';
import { useApi } from '@/lib/useApi';

type Data = {
  lead: { id: string; leadCode: string; leadType: string; name: string; contactPerson: string | null; phone: string; whatsapp: string | null; email: string | null; gstNumber: string | null; city: string | null; state: string | null; address: string | null; source: string; status: string; priority: string; remarks: string | null; convertedEntityId: string | null; owner: { user: { fullName: string } } | null };
  activities: { id: string; type: string; outcome: string | null; notes: string | null; fromValue: string | null; toValue: string | null; createdAt: string }[];
  followUps: { id: string; dueAt: string; status: string; followUpType: string; callOutcome: string | null }[];
  documents: { id: string; title: string; fileName: string }[];
};
type Directory = { employees: { id: string; label: string }[]; transporters: { id: string; label: string }[] };

const OUTCOME = { CONNECTED: 'Connected', NOT_CONNECTED: 'Not connected', BUSY: 'Busy', SWITCHED_OFF: 'Switched off', INTERESTED: 'Interested', NOT_INTERESTED: 'Not interested', CALLBACK_REQUESTED: 'Callback requested', MEETING_FIXED: 'Meeting fixed', REGISTRATION_PROMISED: 'Registration promised' };
const FOLLOW = { PHONE_CALL: 'Phone call', WHATSAPP: 'WhatsApp', PHYSICAL_VISIT: 'Physical visit', ONLINE_MEETING: 'Online meeting', EMAIL: 'Email' };
const STATES = INDIAN_STATES.map((s) => ({ value: s, label: s }));
const BIZ = opts({ MANUFACTURER: 'Manufacturer', TRADER: 'Trader', DISTRIBUTOR: 'Distributor', OIL_MARKETING_COMPANY: 'Oil marketing company', REFINERY: 'Refinery', PETROL_PUMP_DEALER: 'Petrol pump dealer', INDUSTRIAL_CONSUMER: 'Industrial consumer', LOGISTICS_PROVIDER: 'Logistics provider', OTHER: 'Other' });

type Modal = 'call' | 'follow' | 'assign' | 'lost' | 'convert' | null;

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const { data, error, mutate } = useApi<Data>(`/employee/leads/${id}`);
  const { data: dir } = useApi<Directory>('/employee/directory', { revalidateOnFocus: false });
  const [m, setM] = useState<Modal>(null);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  const l = data.lead;
  const close = () => setM(null);
  const after = () => void mutate();
  const addr: Field[] = [{ name: 'address', label: 'Address', required: true, initial: l.address ?? '' }, { name: 'city', label: 'City', required: true, initial: l.city ?? '' }, { name: 'state', label: 'State', type: 'select', options: STATES, required: true, initial: l.state ?? '' }, { name: 'pincode', label: 'Pincode', required: true }];
  const convert: Field[] = l.leadType === 'COMPANY'
    ? [{ name: 'companyName', label: 'Company name', required: true, initial: l.name }, { name: 'contactPersonName', label: 'Contact person', required: true, initial: l.contactPerson ?? '' }, { name: 'phone', label: 'Mobile', required: true, initial: l.phone }, { name: 'email', label: 'Email', required: true, initial: l.email ?? '' }, { name: 'gstNumber', label: 'GST number', required: true, initial: l.gstNumber ?? '' }, { name: 'businessType', label: 'Business type', type: 'select', options: BIZ, required: true }, ...addr]
    : l.leadType === 'TRANSPORTER'
      ? [{ name: 'companyName', label: 'Transport company', required: true, initial: l.name }, { name: 'ownerName', label: 'Owner name', required: true, initial: l.contactPerson ?? '' }, { name: 'phone', label: 'Mobile', required: true, initial: l.phone }, { name: 'email', label: 'Email', required: true, initial: l.email ?? '' }, { name: 'panNumber', label: 'PAN', required: true }, { name: 'gstNumber', label: 'GST number', initial: l.gstNumber ?? '' }, ...addr]
      : [{ name: 'transporterId', label: 'Transporter', type: 'select', options: dir?.transporters.map((t) => ({ value: t.id, label: t.label })) ?? [], required: true }, { name: 'fullName', label: 'Driver name', required: true, initial: l.name }, { name: 'phone', label: 'Mobile', required: true, initial: l.phone }, { name: 'address', label: 'Address', required: true, initial: l.address ?? '' }, { name: 'licenceNumber', label: 'Driving licence', required: true }, { name: 'licenceExpiry', label: 'Licence expiry', type: 'date', required: true }, { name: 'emergencyContactName', label: 'Emergency contact', required: true }, { name: 'emergencyContactPhone', label: 'Emergency mobile', required: true }];
  const editable = can('leads.edit') && !['LOST'].includes(l.status);
  return (
    <>
      <PageHeader title={l.name} subtitle={`${l.leadCode} · ${humanize(l.leadType)}`} back={{ href: '/employee/leads', label: 'Leads' }} actions={<><Badge tone="info">{humanize(l.status)}</Badge>
        {editable && <Button size="sm" variant="secondary" onClick={() => setM('call')}>Log call / meeting</Button>}
        {editable && <Button size="sm" variant="secondary" onClick={() => setM('follow')}>Schedule follow-up</Button>}
        {can('leads.assign') && <Button size="sm" variant="secondary" onClick={() => setM('assign')}>Assign / transfer</Button>}
        {editable && !l.convertedEntityId && <Button size="sm" onClick={() => setM('convert')}>Convert</Button>}
        {editable && !l.convertedEntityId && <Button size="sm" variant="danger" onClick={() => setM('lost')}>Mark lost</Button>}</>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Details"><dl className="divide-y divide-line"><KV label="Contact">{l.contactPerson}</KV><KV label="Mobile"><a className="text-brand-600" href={`tel:${l.phone}`}>{l.phone}</a></KV><KV label="WhatsApp">{l.whatsapp}</KV><KV label="Email">{l.email}</KV><KV label="GST">{l.gstNumber}</KV><KV label="Location">{[l.address, l.city, l.state].filter(Boolean).join(', ')}</KV><KV label="Source">{humanize(l.source)}</KV><KV label="Priority">{humanize(l.priority)}</KV><KV label="Assigned">{l.owner?.user.fullName}</KV><KV label="Remarks">{l.remarks}</KV></dl></Section>
        <div className="space-y-5">
          <Section title="Follow-ups">{data.followUps.length === 0 ? <p className="text-sm text-muted">None yet.</p> : <ul className="space-y-1.5 text-sm">{data.followUps.map((f) => <li key={f.id} className="flex justify-between gap-2"><span>{humanize(f.followUpType)} · {dateTimeIST(f.dueAt)}</span><span className="text-muted">{f.callOutcome ? humanize(f.callOutcome) : humanize(f.status)}</span></li>)}</ul>}</Section>
          <Section title="Documents">
            {can('leads.edit') && <div className="mb-3"><DocumentUpload endpoint={`/employee/leads/${id}/documents`} fieldName="title" types={{ 'Business card': 'Business card', 'GST copy': 'GST copy', 'Other document': 'Other document' }} onDone={after} /></div>}
            <ul className="text-sm">{data.documents.map((d) => <li key={d.id} className="flex items-center justify-between gap-2 py-1"><span className="truncate">{d.title}</span><FileLinks path={`/employee/leads/${id}/documents/${d.id}`} /></li>)}</ul>
          </Section>
        </div>
      </div>
      <div className="mt-5"><Section title="Complete history"><ol className="space-y-2 text-sm">{data.activities.map((a) => <li key={a.id}><strong>{humanize(a.type)}</strong>{a.outcome ? ` · ${humanize(a.outcome)}` : ''}{a.toValue ? ` → ${humanize(a.toValue)}` : ''}{a.notes ? ` · ${a.notes}` : ''}<span className="block text-xs text-muted">{dateTimeIST(a.createdAt)}</span></li>)}</ol></Section></div>

      <FormModal open={m === 'call'} onClose={close} title="Log activity" submit="Save" fields={[{ name: 'type', label: 'Type', type: 'select', options: opts({ CALL: 'Call', MEETING: 'Meeting' }), required: true, initial: 'CALL' }, { name: 'outcome', label: 'Outcome', type: 'select', options: opts(OUTCOME), required: true }, { name: 'minutes', label: 'Duration (minutes)', type: 'number' }, { name: 'notes', label: 'Notes', type: 'textarea' }]} onSubmit={async (v) => { const { minutes, ...b } = clean(v); await api.post('/employee/call-logs', { leadId: id, ...b, ...(minutes ? { durationSeconds: Number(minutes) * 60 } : {}) }); after(); }} />
      <FormModal open={m === 'follow'} onClose={close} title="Schedule follow-up" submit="Schedule" fields={[{ name: 'dueAt', label: 'Date and time', type: 'datetime-local', required: true }, { name: 'followUpType', label: 'Type', type: 'select', options: opts(FOLLOW), required: true, initial: 'PHONE_CALL' }, { name: 'notes', label: 'Notes', type: 'textarea' }]} onSubmit={async (v) => { const b = clean(v); await api.post('/employee/follow-ups', { leadId: id, ...b, dueAt: iso(b.dueAt) }); after(); }} />
      <FormModal open={m === 'assign'} onClose={close} title="Assign lead" submit="Assign" fields={[{ name: 'employeeId', label: 'Employee', type: 'select', options: dir?.employees.map((e) => ({ value: e.id, label: e.label })) ?? [], required: true }, { name: 'reason', label: 'Reason' }]} onSubmit={async (v) => { await api.post(`/employee/leads/${id}/assign`, clean(v)); after(); }} />
      <FormModal open={m === 'lost'} onClose={close} title="Mark lead lost" submit="Mark lost" fields={[{ name: 'reason', label: 'Reason', type: 'textarea', required: true }]} onSubmit={async (v) => { await api.post(`/employee/leads/${id}/lost`, v); after(); }} />
      <FormModal open={m === 'convert'} onClose={close} title={`Register this ${l.leadType.toLowerCase()}`} submit="Register" fields={convert} onSubmit={async (v) => { await api.post(`/employee/leads/${id}/convert`, clean(v)); after(); }} />
    </>
  );
}
