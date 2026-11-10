'use client';

import Link from 'next/link';
import { useState } from 'react';
import { clean, FormModal, ListPage, useCan } from '@/components/employee/kit';
import { Badge, Button } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateIST, humanize } from '@/lib/format';
import { INDIAN_STATES } from '@/lib/status';

type T = { id: string; transporterCode: string; companyName: string; city: string; verificationStatus: string; createdAt: string; owner: { fullName: string; phone: string }; _count: { tankers: number; drivers: number } };
const list = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);

export default function Page() {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <ListPage<T> title="Transporter management" path="/employee/transporters" refreshKey={key} rowKey={(t) => t.id} actions={can('transporters.create') ? <Button onClick={() => setOpen(true)}>Register transporter</Button> : undefined} columns={[{ key: 'c', label: 'ID', render: (t) => <Link className="font-semibold text-brand-600" href={`/employee/transporters/${t.id}`}>{t.transporterCode}</Link> }, { key: 'n', label: 'Name', render: (t) => t.companyName }, { key: 'o', label: 'Owner', render: (t) => `${t.owner.fullName}, ${t.owner.phone}` }, { key: 'ci', label: 'City', render: (t) => t.city }, { key: 'f', label: 'Tankers / drivers', render: (t) => `${t._count.tankers} / ${t._count.drivers}` }, { key: 's', label: 'Status', render: (t) => <Badge tone={t.verificationStatus === 'APPROVED' ? 'success' : t.verificationStatus === 'REJECTED' ? 'danger' : 'warning'}>{humanize(t.verificationStatus)}</Badge> }, { key: 'd', label: 'Registered', render: (t) => dateIST(t.createdAt) }]} />
      <FormModal open={open} onClose={() => setOpen(false)} title="Register transporter" submit="Register" fields={[{ name: 'companyName', label: 'Transport company', required: true }, { name: 'ownerName', label: 'Owner name', required: true }, { name: 'phone', label: 'Mobile', required: true }, { name: 'email', label: 'Email', required: true }, { name: 'panNumber', label: 'PAN', required: true }, { name: 'gstNumber', label: 'GST' }, { name: 'address', label: 'Business address', required: true }, { name: 'city', label: 'City', required: true }, { name: 'state', label: 'State', type: 'select', options: INDIAN_STATES.map((s) => ({ value: s, label: s })), required: true }, { name: 'pincode', label: 'Pincode', required: true }, { name: 'operatingCities', label: 'Operating cities', hint: 'Comma separated' }, { name: 'preferredRoutes', label: 'Operating routes', hint: 'Comma separated' }, { name: 'declaredTankers', label: 'Number of tankers', type: 'number' }, { name: 'capacityCategories', label: 'Tanker capacity (KL)', hint: 'Comma separated' }, { name: 'productCategories', label: 'Product categories', hint: 'Comma separated' }]} onSubmit={async (v) => { const { operatingCities, preferredRoutes, declaredTankers, capacityCategories, productCategories, ...b } = clean(v); await api.post('/employee/transporters', { ...b, operatingCities: list(operatingCities), preferredRoutes: list(preferredRoutes), capacityCategories: list(capacityCategories), productCategories: list(productCategories), ...(declaredTankers ? { declaredTankers: Number(declaredTankers) } : {}) }); setKey((k) => k + 1); }} />
    </>
  );
}
