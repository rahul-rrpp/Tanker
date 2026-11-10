'use client';

import { Check, Paperclip } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import clsx from 'clsx';
import { FileLinks, TicketStatusBadge } from '@/components/portal/bits';
import { ErrorBlock, KV, LoadingBlock, PageHeader, SectionTitle } from '@/components/ui/kit';
import { Card } from '@/components/ui/primitives';
import { dateTimeIST } from '@/lib/format';
import { TICKET_CATEGORIES } from '@/lib/status';
import { useApi } from '@/lib/useApi';
import type { Ticket } from '../page';

const FLOW = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED'];
const LABEL: Record<string, string> = { OPEN: 'Open', UNDER_REVIEW: 'Under review', RESOLVED: 'Resolved', CLOSED: 'Closed' };

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, mutate } = useApi<{ ticket: Ticket & { attachments: { id: string; fileName: string; mimeType: string; sizeBytes: number }[]; createdBy: { fullName: string } | null } }>(`/support/tickets/${id}`);
  if (error) return <ErrorBlock error={error} onRetry={() => mutate()} />;
  if (!data) return <LoadingBlock />;
  const t = data.ticket;
  const idx = FLOW.indexOf(t.status);
  return (
    <div className="space-y-5">
      <PageHeader back={{ href: '/company/support', label: 'Support & Complaints' }} title={`${t.ticketNumber} · ${t.subject}`} subtitle={<TicketStatusBadge status={t.status} />} />
      <Card>
        <ol className="grid grid-cols-4 gap-2" aria-label="Complaint status">
          {FLOW.map((s, i) => (
            <li key={s} className="text-center">
              <span className={clsx('mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold', i < idx || (i === idx && i >= 2) ? 'bg-green-600 text-white' : i === idx ? 'bg-brand-600 text-white ring-4 ring-brand-100' : 'bg-slate-200 text-muted')}>
                {i < idx || (i === idx && i >= 2) ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span className="mt-1 block text-xs font-medium text-ink">{LABEL[s]}</span>
            </li>
          ))}
        </ol>
      </Card>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <SectionTitle>Complaint</SectionTitle>
          <p className="whitespace-pre-line text-sm text-ink">{t.description}</p>
          {t.resolutionNote && (
            <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
              <p className="font-semibold">Resolution{t.resolvedAt ? ` · ${dateTimeIST(t.resolvedAt)}` : ''}</p>
              <p className="mt-1">{t.resolutionNote}</p>
            </div>
          )}
          {t.attachments.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-ink">
                <Paperclip className="h-4 w-4" /> Attachments
              </p>
              <ul className="space-y-2">
                {t.attachments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                    <span className="truncate">{a.fileName}</span>
                    <FileLinks href={`/api/v1/support/tickets/${t.id}/attachments/${a.id}`} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <Card>
          <SectionTitle>Details</SectionTitle>
          <dl className="divide-y divide-line">
            <KV label="Category">{TICKET_CATEGORIES[t.category]}</KV>
            <KV label="Booking">
              {t.booking ? (
                <Link href={`/company/bookings/${t.booking.id}`} className="text-brand-600 hover:underline">
                  {t.booking.bookingCode}
                </Link>
              ) : (
                '—'
              )}
            </KV>
            <KV label="Raised by">{t.createdBy?.fullName ?? '—'}</KV>
            <KV label="Raised on">{dateTimeIST(t.createdAt)}</KV>
            <KV label="Last update">{dateTimeIST(t.updatedAt)}</KV>
          </dl>
        </Card>
      </div>
    </div>
  );
}
