'use client';

import { useRouter } from 'next/navigation';
import { emptyTanker, TankerForm } from '@/components/transporter/TankerForm';
import { PageHeader, useToast } from '@/components/ui/kit';
import { Card } from '@/components/ui/primitives';
import { api } from '@/lib/api';

export default function Page() {
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <PageHeader title="Add tanker" subtitle="Next you will upload its documents for verification" back={{ href: '/transporter/fleet', label: 'My fleet' }} />
      <Card className="p-5"><TankerForm initial={emptyTanker} submitLabel="Add tanker" onSubmit={async (body) => { const r = await api.post('/tankers', body); toast.success(r.data.message); router.push(`/transporter/fleet/${r.data.data.tanker.id}`); }} /></Card>
    </>
  );
}
