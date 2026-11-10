'use client';

import { FileText } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { FileLinks } from '@/components/portal/bits';
import { DemoBadge, EmptyState, ErrorBlock, LoadingBlock, PageHeader } from '@/components/ui/kit';
import { Button, Card, SelectField, TextField } from '@/components/ui/primitives';
import type { BookingRow } from '@/lib/company-types';
import { dateTimeIST, humanize } from '@/lib/format';
import { DOC_TYPES } from '@/lib/status';
import { useApi } from '@/lib/useApi';

interface Doc {
  id: string;
  type: string;
  subType?: string;
  title: string;
  reference: string;
  bookingId: string;
  bookingCode: string;
  date: string;
  isDemo: boolean;
  mimeType: string;
}

function DocumentsInner() {
  const params = useSearchParams();
  const [f, setF] = useState({ type: '', bookingId: params.get('booking') ?? '', from: '', to: '' });
  const [q, setQ] = useState('');
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  const { data, error, isLoading, mutate } = useApi<{ documents: Doc[] }>(`/documents?${qs}`);
  const { data: bookings } = useApi<{ items: BookingRow[] }>('/bookings?tab=all&pageSize=100');
  const needle = q.trim().toLowerCase();
  const visible = (docs: Doc[]) => (needle ? docs.filter((d) => [d.title, d.reference, d.bookingCode, DOC_TYPES[d.type]].some((v) => (v ?? '').toLowerCase().includes(needle))) : docs);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <div className="space-y-5">
      <PageHeader title="Invoices & Documents" subtitle="Booking confirmations, freight invoices, payment receipts and transport documents." />
      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="sm:col-span-2 lg:col-span-1">
          <TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Invoice, receipt, booking…" />
        </div>
        <SelectField label="Document type" value={f.type} onChange={set('type')} options={[{ value: '', label: 'All documents' }, ...Object.entries(DOC_TYPES).filter(([k]) => k !== 'BOOKING_SUMMARY').map(([value, label]) => ({ value, label }))]} />
        <SelectField label="Booking" value={f.bookingId} onChange={set('bookingId')} options={[{ value: '', label: 'All bookings' }, ...(bookings?.items.map((b) => ({ value: b.id, label: b.bookingCode })) ?? [])]} />
        <TextField label="From" type="date" value={f.from} onChange={set('from')} />
        <TextField label="To" type="date" value={f.to} onChange={set('to')} />
        <div className="flex items-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setF({ type: '', bookingId: '', from: '', to: '' });
              setQ('');
            }}
          >
            Clear filters
          </Button>
        </div>
      </Card>

      {error ? (
        <ErrorBlock error={error} onRetry={() => mutate()} />
      ) : isLoading || !data ? (
        <LoadingBlock />
      ) : visible(data.documents).length === 0 ? (
        <EmptyState title="No documents found" icon={<FileText className="h-6 w-6" />}>
          Documents are generated automatically as bookings are confirmed, invoiced, paid and delivered.
        </EmptyState>
      ) : (
        <Card className="!p-0">
          <ul className="divide-y divide-line">
            {visible(data.documents).map((d) => (
              <li key={d.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                    <FileText className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                      {d.title} {d.isDemo && <DemoBadge />}
                    </p>
                    <p className="text-sm text-muted">
                      {DOC_TYPES[d.type]} · {d.type === 'TRIP_DOCUMENT' ? humanize(d.subType ?? '') : d.reference} ·{' '}
                      <Link href={`/company/bookings/${d.bookingId}`} className="text-brand-600 hover:underline">
                        {d.bookingCode}
                      </Link>{' '}
                      · {dateTimeIST(d.date)}
                    </p>
                  </div>
                </div>
                <FileLinks href={`/api/v1/documents/${encodeURIComponent(d.id)}`} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export default function DocumentsPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <DocumentsInner />
    </Suspense>
  );
}
