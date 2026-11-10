'use client';

import clsx from 'clsx';
import { Bell, CheckCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSWRConfig } from 'swr';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, Pagination, Tabs, useToast } from '@/components/ui/kit';
import { Button, Card } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import type { NotificationItem } from '@/lib/company-types';
import { dateTimeIST, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/useApi';

const TONE: Record<string, string> = {
  OFFER_RECEIVED: 'bg-orange-500',
  COUNTER_OFFER_RECEIVED: 'bg-orange-500',
  COUNTER_OFFER_ACCEPTED: 'bg-green-600',
  BOOKING_CONFIRMED: 'bg-green-600',
  DELIVERY_COMPLETED: 'bg-green-600',
  PAYMENT_RECEIVED: 'bg-green-600',
  PAYMENT_PENDING: 'bg-orange-500',
  PAYMENT_FAILED: 'bg-red-600',
  BOOKING_CANCELLED: 'bg-red-600',
  OFFER_EXPIRED: 'bg-slate-400',
};

export default function NotificationsPage() {
  const router = useRouter();
  const toast = useToast();
  const { mutate: globalMutate } = useSWRConfig();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);
  const { data, error, isLoading, mutate } = useApi<{ total: number; unread: number; page: number; pageSize: number; items: NotificationItem[] }>(
    `/notifications?page=${page}&pageSize=20${filter === 'unread' ? '&unread=true' : ''}`,
  );
  const refresh = () => {
    void mutate();
    void globalMutate('/notifications/unread-count');
  };

  async function open(n: NotificationItem) {
    if (!n.readAt) await api.put(`/notifications/${n.id}/read`).catch(() => undefined);
    refresh();
    if (n.link) router.push(n.link);
  }

  async function markRead(n: NotificationItem) {
    try {
      await api.put(`/notifications/${n.id}/read`);
      refresh();
    } catch (e) {
      toast.error(e);
    }
  }

  async function markAll() {
    try {
      const { data: res } = await api.put('/notifications/read-all');
      toast.success(`${res.data.updated} notification(s) marked as read`);
      refresh();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        subtitle="Booking, offer, trip and payment updates. SMS and WhatsApp delivery can be enabled in Settings once connected."
        actions={
          <Button variant="secondary" size="sm" onClick={markAll} disabled={!data?.unread}>
            <CheckCheck className="h-4 w-4" /> Mark all as read
          </Button>
        }
      />
      <Tabs
        tabs={[
          { value: 'all', label: 'All' },
          { value: 'unread', label: 'Unread' },
        ]}
        value={filter}
        onChange={(v) => {
          setFilter(v);
          setPage(1);
        }}
        counts={{ unread: data?.unread }}
      />
      {error ? (
        <ErrorBlock error={error} onRetry={() => mutate()} />
      ) : isLoading || !data ? (
        <LoadingBlock />
      ) : data.items.length === 0 ? (
        <EmptyState title={filter === 'unread' ? "You're all caught up" : 'No notifications yet'} icon={<Bell className="h-6 w-6" />} />
      ) : (
        <Card className="!p-0">
          <ul className="divide-y divide-line">
            {data.items.map((n) => (
              <li key={n.id} className={clsx('flex gap-3 px-5 py-4', !n.readAt && 'bg-brand-50/50')}>
                <span className={clsx('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', n.readAt ? 'bg-slate-300' : (TONE[n.type] ?? 'bg-brand-600'))} aria-hidden />
                <div className="min-w-0 flex-1">
                  <button onClick={() => open(n)} className="text-left">
                    <p className={clsx('text-sm text-ink', !n.readAt && 'font-semibold')}>{n.title}</p>
                    <p className="text-sm text-muted">{n.message}</p>
                  </button>
                  <p className="mt-1 text-xs text-muted" title={dateTimeIST(n.createdAt)}>
                    {timeAgo(n.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {n.link && (
                    <button onClick={() => open(n)} className="text-xs font-semibold text-brand-600 hover:text-brand-700">
                      {n.bookingId ? 'Open booking' : 'Open'}
                    </button>
                  )}
                  {!n.readAt && (
                    <button onClick={() => markRead(n)} className="text-xs font-medium text-muted hover:text-ink">
                      Mark as read
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="px-5 pb-4">
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
          </div>
        </Card>
      )}
    </div>
  );
}
