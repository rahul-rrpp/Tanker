'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { FormModal, Section, useCan } from '@/components/employee/kit';
import { DocumentUpload } from '@/components/transporter/ui';
import { ErrorBlock, KV, LoadingBlock, PageHeader } from '@/components/ui/kit';
import { Badge, Button } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateIST, dateTimeIST, humanize, inr } from '@/lib/format';
import { COMPANY_DOC_TYPES } from '@/lib/status';
import { useApi } from '@/lib/useApi';

type Data = { company: { id: string; companyCode: string; name: string; gstNumber: string; contactPersonName: string; contactPhone: string; contactEmail: string; status: string; statusReason: string | null; addresses: { address: string; city: string; state: string }[]; documents: { id: string; type: string; fileName: string; status: string; reviewNote: string | null }[] }; bookings: { id: string; bookingCode: string; status: string; createdAt: string; customerOffer: string }[]; verificationHistory: { id: string; toStatus: string; reason: string | null; reviewer: string; createdAt: string }[]; attribution: { employeeCode: string | null; employeeName: string | null; registrationDate: string; leadCode: string | null; leadSource: string | null; branch: string | null; territory: string | null; accountManagers: { name: string; code: string; from: string; to: string | null }[] } };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const { data, error, mutate } = useApi<Data>(`/employee/companies/${id}`);
  const { data: dir } = useApi<{ employees: { id: string; label: string }[] }>('/employee/directory', { revalidateOnFocus: false });
  const [assign, setAssign] = useState(false);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  const c = data.company;
  const a = data.attribution;
  return (
    <>
      <PageHeader title={c.name} subtitle={c.companyCode} back={{ href: '/employee/companies', label: 'Companies' }} actions={<><Badge tone={c.status === 'VERIFIED' ? 'success' : 'warning'}>{humanize(c.status)}</Badge>{can('companies.assign') && <Button size="sm" variant="secondary" onClick={() => setAssign(true)}>Assign account manager</Button>}</>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Profile"><dl className="divide-y divide-line"><KV label="GST">{c.gstNumber}</KV><KV label="Contact">{c.contactPersonName}, {c.contactPhone}</KV><KV label="Email">{c.contactEmail}</KV><KV label="Address">{c.addresses[0] ? `${c.addresses[0].address}, ${c.addresses[0].city}, ${c.addresses[0].state}` : null}</KV><KV label="Status reason">{c.statusReason}</KV></dl></Section>
        <Section title="Attribution"><dl className="divide-y divide-line"><KV label="Registered by">{a.employeeName ? `${a.employeeName} (${a.employeeCode})` : 'Self-registered'}</KV><KV label="Date">{dateTimeIST(a.registrationDate)}</KV><KV label="Lead">{a.leadCode}</KV><KV label="Lead source">{a.leadSource ? humanize(a.leadSource) : null}</KV><KV label="Branch / territory">{[a.branch, a.territory].filter(Boolean).join(' / ')}</KV><KV label="Account managers">{a.accountManagers.map((m) => `${m.name}${m.to ? ' (past)' : ''}`).join(', ')}</KV></dl></Section>
        <Section title="Documents">{can('companies.create') && <div className="mb-3"><DocumentUpload endpoint={`/employee/companies/${id}/documents`} fieldName="type" types={COMPANY_DOC_TYPES} onDone={() => void mutate()} /></div>}<ul className="space-y-1 text-sm">{c.documents.map((d) => <li key={d.id} className="flex justify-between gap-2"><span>{COMPANY_DOC_TYPES[d.type]}{d.reviewNote ? ` · ${d.reviewNote}` : ''}</span><span className="text-muted">{humanize(d.status)}</span></li>)}</ul></Section>
        <Section title="Verification history">{data.verificationHistory.length === 0 ? <p className="text-sm text-muted">No reviews yet.</p> : <ul className="space-y-1 text-sm">{data.verificationHistory.map((h) => <li key={h.id}>{humanize(h.toStatus)} by {h.reviewer} · {dateTimeIST(h.createdAt)}{h.reason ? ` · ${h.reason}` : ''}</li>)}</ul>}</Section>
      </div>
      {data.bookings.length > 0 && <div className="mt-5"><Section title="Booking history"><ul className="divide-y divide-line text-sm">{data.bookings.map((b) => <li key={b.id} className="flex justify-between gap-2 py-1.5"><Link className="font-semibold text-brand-600" href={`/employee/bookings/${b.id}`}>{b.bookingCode}</Link><span>{humanize(b.status)} · {inr(b.customerOffer)} · {dateIST(b.createdAt)}</span></li>)}</ul></Section></div>}
      <FormModal open={assign} onClose={() => setAssign(false)} title="Assign account manager" submit="Assign" fields={[{ name: 'employeeId', label: 'Employee', type: 'select', options: dir?.employees.map((e) => ({ value: e.id, label: e.label })) ?? [], required: true }]} onSubmit={async (v) => { await api.post(`/employee/companies/${id}/account-manager`, v); void mutate(); }} />
    </>
  );
}
