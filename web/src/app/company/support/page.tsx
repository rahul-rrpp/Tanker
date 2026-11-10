'use client';

import { LifeBuoy, Paperclip, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { TicketStatusBadge } from '@/components/portal/bits';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, Tabs } from '@/components/ui/kit';
import { Card } from '@/components/ui/primitives';
import { dateTimeIST } from '@/lib/format';
import { TICKET_CATEGORIES } from '@/lib/status';
import { useApi } from '@/lib/useApi';

export interface Ticket {
  id: string;
  ticketNumber: string;
  category: string;
  subject: string;
  description: string;
  status: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  booking: { id: string; bookingCode: string; status?: string } | null;
  _count?: { attachments: number };
}

type F = 'ALL' | 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'CLOSED';

export default function SupportPage() {
  const [status, setStatus] = useState<F>('ALL');
  const { data, error, isLoading, mutate } = useApi<{ tickets: Ticket[] }>(`/support/tickets${status === 'ALL' ? '' : `?status=${status}`}`);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Support & Complaints"
        subtitle="Raise an issue about a booking, trip or payment and follow its status."
        actions={
          <Link href="/company/support/new" className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-field)] bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
            <Plus className="h-4 w-4" /> Raise a complaint
          </Link>
        }
      />
      <Tabs
        tabs={[
          { value: 'ALL', label: 'All' },
          { value: 'OPEN', label: 'Open' },
          { value: 'UNDER_REVIEW', label: 'Under review' },
          { value: 'RESOLVED', label: 'Resolved' },
          { value: 'CLOSED', label: 'Closed' },
        ]}
        value={status}
        onChange={setStatus}
      />
      {error ? (
        <ErrorBlock error={error} onRetry={() => mutate()} />
      ) : isLoading || !data ? (
        <LoadingBlock />
      ) : data.tickets.length === 0 ? (
        <EmptyState title="No complaints" icon={<LifeBuoy className="h-6 w-6" />} action={<Link href="/company/support/new" className="font-semibold text-brand-600">Raise a complaint</Link>}>
          If something goes wrong with a booking, trip or payment, tell us here.
        </EmptyState>
      ) : (
        <Card className="!p-0">
          <ul className="divide-y divide-line">
            {data.tickets.map((t) => (
              <li key={t.id}>
                <Link href={`/company/support/${t.id}`} className="flex flex-col gap-2 px-5 py-4 hover:bg-canvas/60 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">
                      {t.ticketNumber} · {t.subject}
                    </p>
                    <p className="text-sm text-muted">
                      {TICKET_CATEGORIES[t.category]}
                      {t.booking ? ` · ${t.booking.bookingCode}` : ''} · raised {dateTimeIST(t.createdAt)}
                      {t._count?.attachments ? (
                        <span className="ml-2 inline-flex items-center gap-0.5">
                          <Paperclip className="h-3.5 w-3.5" /> {t._count.attachments}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <TicketStatusBadge status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
