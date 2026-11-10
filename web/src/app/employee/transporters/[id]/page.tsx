'use client';

import { use, useState } from 'react';
import { FormModal, Section, useCan } from '@/components/employee/kit';
import { DocumentUpload } from '@/components/transporter/ui';
import { ErrorBlock, KV, LoadingBlock, PageHeader } from '@/components/ui/kit';
import { Badge, Button } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import type { Catalog } from '@/lib/company-types';
import { dateTimeIST, humanize } from '@/lib/format';
import { BUSINESS_DOCS } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

type Data = { transporter: { transporterCode: string; companyName: string; gstNumber: string | null; panNumber: string; address: string; city: string; state: string; verificationStatus: string; rejectionReason: string | null; operatingCities: string[]; preferredRoutes: string[]; declaredTankers: number | null; owner: { fullName: string; phone: string; email: string | null } }; documents: { id: string; docType: string; status: string; reviewNote: string | null }[]; tankers: { id: string; registrationNumber: string; capacityKl: string; verificationStatus: string }[]; drivers: { id: string; licenceNumber: string; verificationStatus: string; user: { fullName: string } }[]; verificationHistory: { id: string; toStatus: string; reviewer: string; reason: string | null; createdAt: string }[]; attribution: { employeeCode: string | null; employeeName: string | null; registrationDate: string; leadCode: string | null; leadSource: string | null } };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const { data, error, mutate } = useApi<Data>(`/employee/transporters/${id}`);
  const { data: catalog } = useApi<Catalog>('/catalog', { revalidateOnFocus: false });
  const [add, setAdd] = useState(false);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  const t = data.transporter;
  const a = data.attribution;
  return (
    <>
      <PageHeader title={t.companyName} subtitle={t.transporterCode} back={{ href: '/employee/transporters', label: 'Transporters' }} actions={<><Badge tone={t.verificationStatus === 'APPROVED' ? 'success' : 'warning'}>{humanize(t.verificationStatus)}</Badge>{can('tankers.create') && <Button size="sm" variant="secondary" onClick={() => setAdd(true)}>Add tanker</Button>}</>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Profile"><dl className="divide-y divide-line"><KV label="Owner">{t.owner.fullName}, {t.owner.phone}</KV><KV label="Email">{t.owner.email}</KV><KV label="GST / PAN">{t.gstNumber ?? '—'} / {t.panNumber}</KV><KV label="Address">{t.address}, {t.city}, {t.state}</KV><KV label="Operating cities">{t.operatingCities.join(', ')}</KV><KV label="Routes">{t.preferredRoutes.join(', ')}</KV><KV label="Declared tankers">{t.declaredTankers}</KV><KV label="Rejection reason">{t.rejectionReason}</KV></dl></Section>
        <Section title="Attribution"><dl className="divide-y divide-line"><KV label="Registered by">{a.employeeName ? `${a.employeeName} (${a.employeeCode})` : 'Self-registered'}</KV><KV label="Date">{dateTimeIST(a.registrationDate)}</KV><KV label="Lead">{a.leadCode}</KV><KV label="Lead source">{a.leadSource ? humanize(a.leadSource) : null}</KV></dl></Section>
        <Section title="Documents">{can('transporters.create') && <div className="mb-3"><DocumentUpload endpoint={`/employee/transporters/${id}/documents`} types={BUSINESS_DOCS} expiry onDone={() => void mutate()} /></div>}<ul className="space-y-1 text-sm">{data.documents.map((d) => <li key={d.id} className="flex justify-between gap-2"><span>{BUSINESS_DOCS[d.docType] ?? d.docType}{d.reviewNote ? ` · ${d.reviewNote}` : ''}</span><span className="text-muted">{humanize(d.status)}</span></li>)}</ul></Section>
        <Section title="Fleet and drivers"><ul className="space-y-1 text-sm">{data.tankers.map((k) => <li key={k.id} className="flex justify-between"><span>{k.registrationNumber} · {k.capacityKl} KL</span><span className="text-muted">{humanize(k.verificationStatus)}</span></li>)}{data.drivers.map((d) => <li key={d.id} className="flex justify-between"><span>{d.user.fullName} · {d.licenceNumber}</span><span className="text-muted">{humanize(d.verificationStatus)}</span></li>)}</ul></Section>
      </div>
      <FormModal open={add} onClose={() => setAdd(false)} title="Add tanker" submit="Add" fields={[{ name: 'registrationNumber', label: 'Registration number', required: true }, { name: 'capacityKl', label: 'Capacity (KL)', type: 'number', required: true }, { name: 'tankerTypeId', label: 'Tanker type', type: 'select', options: catalog?.tankerTypes.map((x) => ({ value: x.id, label: x.name })) ?? [], required: true }, { name: 'compartments', label: 'Compartments', type: 'number', initial: '1', required: true }, { name: 'productId', label: 'Permitted product', type: 'select', options: catalog?.products.map((x) => ({ value: x.id, label: x.name })) ?? [], required: true }]} onSubmit={async (v) => { await api.post(`/employee/transporters/${id}/tankers`, { registrationNumber: v.registrationNumber.toUpperCase().replace(/\s/g, ''), capacityKl: Number(v.capacityKl), tankerTypeId: v.tankerTypeId, compartments: Number(v.compartments), productIds: [v.productId] }); void mutate(); }} />
    </>
  );
}
