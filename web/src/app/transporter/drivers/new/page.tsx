'use client';

import { useRouter } from 'next/navigation';
import { DriverForm, emptyDriver } from '@/components/transporter/DriverForm';
import { PageHeader, useToast } from '@/components/ui/kit';
import { Card } from '@/components/ui/primitives';
import { api } from '@/lib/api';

export default function Page() {
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <PageHeader title="Add driver" subtitle="Then upload their documents and send a login invitation" back={{ href: '/transporter/drivers', label: 'Drivers' }} />
      <Card className="p-5"><DriverForm initial={emptyDriver} submitLabel="Add driver" onSubmit={async (b) => { const r = await api.post('/transporters/me/drivers', b); toast.success(r.data.message); router.push(`/transporter/drivers/${r.data.data.driver.id}`); }} /></Card>
    </>
  );
}
