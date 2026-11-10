'use client';

import Link from 'next/link';
import { useState } from 'react';
import { clean, FormModal, ListPage, opts, useCan } from '@/components/employee/kit';
import { Badge, Button } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateIST, humanize } from '@/lib/format';
import { INDIAN_STATES } from '@/lib/status';

type C = { id: string; companyCode: string; name: string; contactPersonName: string; contactPhone: string; status: string; createdAt: string };
const BIZ = { MANUFACTURER: 'Manufacturer', TRADER: 'Trader', DISTRIBUTOR: 'Distributor', OIL_MARKETING_COMPANY: 'Oil marketing company', REFINERY: 'Refinery', PETROL_PUMP_DEALER: 'Petrol pump dealer', INDUSTRIAL_CONSUMER: 'Industrial consumer', LOGISTICS_PROVIDER: 'Logistics provider', OTHER: 'Other' };

export default function Page() {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <ListPage<C> title="Company management" path="/employee/companies" refreshKey={key} rowKey={(c) => c.id} actions={can('companies.create') ? <Button onClick={() => setOpen(true)}>Register company</Button> : undefined} columns={[{ key: 'c', label: 'Company ID', render: (c) => <Link className="font-semibold text-brand-600" href={`/employee/companies/${c.id}`}>{c.companyCode}</Link> }, { key: 'n', label: 'Name', render: (c) => c.name }, { key: 'p', label: 'Contact', render: (c) => `${c.contactPersonName}, ${c.contactPhone}` }, { key: 's', label: 'Status', render: (c) => <Badge tone={c.status === 'VERIFIED' ? 'success' : c.status === 'REJECTED' ? 'danger' : 'warning'}>{humanize(c.status)}</Badge> }, { key: 'd', label: 'Registered', render: (c) => dateIST(c.createdAt) }]} />
      <FormModal open={open} onClose={() => setOpen(false)} title="Register company" submit="Register" fields={[{ name: 'companyName', label: 'Company name', required: true }, { name: 'contactPersonName', label: 'Contact person', required: true }, { name: 'phone', label: 'Mobile', required: true }, { name: 'email', label: 'Email', required: true }, { name: 'gstNumber', label: 'GST', required: true }, { name: 'businessType', label: 'Business type', type: 'select', options: opts(BIZ), required: true }, { name: 'address', label: 'Address', required: true }, { name: 'city', label: 'City', required: true }, { name: 'state', label: 'State', type: 'select', options: INDIAN_STATES.map((s) => ({ value: s, label: s })), required: true }, { name: 'pincode', label: 'Pincode', required: true }]} onSubmit={async (v) => { await api.post('/employee/companies', clean(v)); setKey((k) => k + 1); }} />
    </>
  );
}
