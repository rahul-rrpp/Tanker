'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { PageHeader, TextArea, useToast } from '@/components/ui/kit';
import { Alert, Button, Card, SelectField, TextField } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';
import { TICKET_CATEGORY_OPTIONS, type Paged } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

function Form() {
  const router = useRouter();
  const toast = useToast();
  const sp = useSearchParams();
  const { data: bookings } = useApi<Paged<{ id: string; bookingCode: string }>>('/transporters/me/bookings?all=1&pageSize=100', { shouldRetryOnError: false });
  const [f, setF] = useState({ category: sp.get('category') ?? 'BOOKING_ISSUE', bookingId: '', subject: sp.get('subject') ?? '', description: '', priority: 'MEDIUM' });
  const [files, setFiles] = useState<File[]>([]);
  const [fail, setFail] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const bind = (k: keyof typeof f) => ({ value: f[k], error: fields[k], onChange: (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value })) });
  const submit = async () => {
    setBusy(true);
    setFail(null);
    setFields({});
    const form = new FormData();
    Object.entries(f).forEach(([k, v]) => { if (v) form.append(k, v); });
    files.forEach((x) => form.append('attachments', x));
    try {
      const r = await api.post('/support/tickets', form);
      toast.success(r.data.message);
      router.push(`/transporter/support/${r.data.data.ticket.id}`);
    } catch (e) {
      const p = parseApiError(e);
      setFail(p.message);
      setFields(Object.fromEntries(p.fields.map((x) => [x.field, x.message])));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="max-w-2xl space-y-4 p-5">
      {fail && <Alert tone="error">{fail}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Category" {...bind('category')}>{Object.entries(TICKET_CATEGORY_OPTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</SelectField>
        <SelectField label="Priority" {...bind('priority')}>{['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => <option key={p} value={p}>{p.toLowerCase()}</option>)}</SelectField>
      </div>
      <SelectField label="Booking (optional)" {...bind('bookingId')}><option value="">None</option>{bookings?.items.map((b) => <option key={b.id} value={b.id}>{b.bookingCode}</option>)}</SelectField>
      <TextField label="Subject" required {...bind('subject')} />
      <TextArea label="Description" required rows={5} {...bind('description')} />
      <div><p className="mb-1 text-sm font-medium text-ink">Attachments (up to 5)</p><input type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 5))} className="text-sm" /></div>
      <Button loading={busy} disabled={busy} onClick={() => void submit()}>Create ticket</Button>
    </Card>
  );
}

export default function Page() {
  return (
    <>
      <PageHeader title="Create ticket" back={{ href: '/transporter/support', label: 'Support' }} />
      <Suspense><Form /></Suspense>
    </>
  );
}
