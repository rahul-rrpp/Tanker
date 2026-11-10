'use client';

import { useState } from 'react';
import { clean, FormModal, ListPage, useCan } from '@/components/employee/kit';
import { Badge, Button } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dayOnly, humanize } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type D = { id: string; licenceNumber: string; licenceExpiry: string; verificationStatus: string; rejectionReason: string | null; user: { fullName: string; phone: string }; agency: { companyName: string } };

export default function Page() {
  const can = useCan();
  const { data: dir } = useApi<{ transporters: { id: string; label: string }[] }>('/employee/directory', { revalidateOnFocus: false });
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <ListPage<D> title="Driver onboarding" subtitle="Drivers are always registered under a transporter" path="/employee/drivers" refreshKey={key} rowKey={(d) => d.id} actions={can('drivers.create') ? <Button onClick={() => setOpen(true)}>Register driver</Button> : undefined} columns={[{ key: 'n', label: 'Driver', render: (d) => d.user.fullName }, { key: 'p', label: 'Mobile', render: (d) => d.user.phone }, { key: 't', label: 'Transporter', render: (d) => d.agency.companyName }, { key: 'l', label: 'Licence', render: (d) => d.licenceNumber }, { key: 'e', label: 'Expiry', render: (d) => dayOnly(d.licenceExpiry) }, { key: 's', label: 'Status', render: (d) => <Badge tone={d.verificationStatus === 'APPROVED' ? 'success' : d.verificationStatus === 'REJECTED' ? 'danger' : 'warning'}>{humanize(d.verificationStatus)}</Badge> }]} />
      <FormModal open={open} onClose={() => setOpen(false)} title="Register driver" submit="Register" fields={[{ name: 'transporterId', label: 'Transporter', type: 'select', options: dir?.transporters.map((t) => ({ value: t.id, label: t.label })) ?? [], required: true }, { name: 'fullName', label: 'Driver name', required: true }, { name: 'phone', label: 'Mobile', required: true }, { name: 'address', label: 'Address', required: true }, { name: 'licenceNumber', label: 'Driving licence', required: true }, { name: 'licenceExpiry', label: 'Licence expiry', type: 'date', required: true }, { name: 'hazardousTraining', label: 'Hazardous goods training', type: 'select', options: [{ value: 'NOT_PROVIDED', label: 'Not provided' }, { value: 'VALID', label: 'Valid' }, { value: 'PENDING', label: 'Pending' }, { value: 'NOT_REQUIRED', label: 'Not required' }], initial: 'NOT_PROVIDED' }, { name: 'emergencyContactName', label: 'Emergency contact', required: true }, { name: 'emergencyContactPhone', label: 'Emergency mobile', required: true }]} onSubmit={async (v) => { await api.post('/employee/drivers', clean(v)); setKey((k) => k + 1); }} />
    </>
  );
}
