'use client';

import { Paperclip, Trash2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { LoadingBlock, PageHeader, TextArea, useToast } from '@/components/ui/kit';
import { Alert, Button, Card, SelectField, TextField } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';
import type { BookingRow } from '@/lib/company-types';
import { TICKET_CATEGORIES } from '@/lib/status';
import { useApi } from '@/lib/useApi';

const MAX_FILES = 5;
const MAX_MB = 5;
const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';

function NewTicketInner() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { data: bookings } = useApi<{ items: BookingRow[] }>('/bookings?tab=all&pageSize=100');
  const [f, setF] = useState({ category: params.get('category') ?? '', bookingId: params.get('booking') ?? '', subject: '', description: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const file of Array.from(list)) {
      if (next.length >= MAX_FILES) break;
      if (file.size > MAX_MB * 1024 * 1024) {
        toast.error(`${file.name} is larger than ${MAX_MB} MB`);
        continue;
      }
      if (!ACCEPT.split(',').includes(file.type)) {
        toast.error(`${file.name}: only PDF, PNG, JPG or WEBP files`);
        continue;
      }
      next.push(file);
    }
    setFiles(next);
  }

  async function submit() {
    const e: Record<string, string> = {};
    if (!f.category) e.category = 'Select a category';
    if (f.subject.trim().length < 5) e.subject = 'Add a short subject (5+ characters)';
    if (f.description.trim().length < 20) e.description = 'Describe the issue in at least 20 characters';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('category', f.category);
      if (f.bookingId) form.append('bookingId', f.bookingId);
      form.append('subject', f.subject);
      form.append('description', f.description);
      files.forEach((file) => form.append('attachments', file));
      const { data } = await api.post('/support/tickets', form);
      toast.success(`Complaint ${data.data.ticket.ticketNumber} registered`);
      router.push(`/company/support/${data.data.ticket.id}`);
    } catch (err) {
      const p = parseApiError(err);
      setError(p.message);
      setErrors(Object.fromEntries(p.fields.map((x) => [x.field, x.message])));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader back={{ href: '/company/support', label: 'Support & Complaints' }} title="Raise a complaint" subtitle="Our operations team reviews every complaint and updates its status here." />
      <Card className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Complaint category" required value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} error={errors.category} placeholder="Select…" options={Object.entries(TICKET_CATEGORIES).map(([value, label]) => ({ value, label }))} />
          <SelectField label="Booking ID" value={f.bookingId} onChange={(e) => setF({ ...f, bookingId: e.target.value })} error={errors.bookingId} options={[{ value: '', label: 'Not related to a booking' }, ...(bookings?.items.map((b) => ({ value: b.id, label: `${b.bookingCode} · ${b.pickup?.city ?? ''} → ${b.delivery?.city ?? ''}` })) ?? [])]} />
        </div>
        <TextField label="Subject" required value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} error={errors.subject} maxLength={160} />
        <TextArea label="Complaint description" required rows={6} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} error={errors.description} maxLength={4000} hint={`${f.description.length}/4000`} />
        <div>
          <p className="mb-2 text-sm font-medium text-ink">Supporting images / documents</p>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-canvas/50 px-4 py-6 text-sm text-muted hover:border-brand-300">
            <Paperclip className="h-4 w-4" /> Choose files (PDF, PNG, JPG, WEBP · up to {MAX_FILES} files, {MAX_MB} MB each)
            <input type="file" accept={ACCEPT} multiple className="sr-only" onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} disabled={files.length >= MAX_FILES} />
          </label>
          {files.length > 0 && (
            <ul className="mt-3 space-y-2">
              {files.map((file, i) => (
                <li key={`${file.name}-${i}`} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                  <span className="truncate">
                    {file.name} <span className="text-muted">({(file.size / 1024).toFixed(0)} KB)</span>
                  </span>
                  <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="rounded p-1 text-muted hover:text-danger" aria-label={`Remove ${file.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Submit complaint
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default function NewTicketPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <NewTicketInner />
    </Suspense>
  );
}
