'use client';

import Link from 'next/link';
import { TicketStatusBadge } from '@/components/portal/bits';
import { DataTable } from '@/components/transporter/ui';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from '@/components/ui/kit';
import { Button } from '@/components/ui/primitives';
import { dateTimeIST } from '@/lib/format';
import { TICKET_CATEGORY_OPTIONS } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

type T = { id: string; ticketNumber: string; category: string; subject: string; status: string; priority: string; createdAt: string; booking: { bookingCode: string } | null };

export default function Page() {
  const { data, error, mutate } = useApi<{ tickets: T[] }>('/support/tickets');
  return (
    <>
      <PageHeader title="Support & complaints" subtitle="Our team replies here" actions={<Link href="/transporter/support/new"><Button>Create ticket</Button></Link>} />
      {error ? <ErrorBlock error={error} onRetry={() => void mutate()} /> : !data ? <LoadingBlock /> : data.tickets.length === 0 ? <EmptyState title="No tickets" /> : (
        <DataTable rows={data.tickets} rowKey={(t) => t.id} columns={[{ key: 'n', label: 'Ticket', render: (t) => <Link className="font-semibold text-brand-600" href={`/transporter/support/${t.id}`}>{t.ticketNumber}</Link> }, { key: 'c', label: 'Category', render: (t) => TICKET_CATEGORY_OPTIONS[t.category] ?? t.category }, { key: 's', label: 'Subject', render: (t) => t.subject }, { key: 'b', label: 'Booking', render: (t) => t.booking?.bookingCode ?? '—' }, { key: 'p', label: 'Priority', render: (t) => t.priority.toLowerCase() }, { key: 'st', label: 'Status', render: (t) => <TicketStatusBadge status={t.status} /> }, { key: 'd', label: 'Created', render: (t) => dateTimeIST(t.createdAt) }]} />
      )}
    </>
  );
}
