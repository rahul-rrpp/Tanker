'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import { ActionButton } from '@/components/transporter/ui';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, Pagination } from '@/components/ui/kit';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type N = { id: string; title: string; message: string; createdAt: string; readAt: string | null; link: string | null };

export function NotificationList({ fallbackHref }: { fallbackHref: string }) {
  const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi<{ total: number; unread: number; page: number; pageSize: number; items: N[] }>(`/notifications?page=${page}`);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  return (
    <>
      <PageHeader title="Notifications" subtitle={`${data.unread} unread`} actions={data.unread > 0 ? <ActionButton action={() => api.put('/notifications/read-all')} success="All marked as read" onDone={() => void mutate()}>Mark all read</ActionButton> : undefined} />
      {data.items.length === 0 ? <EmptyState title="Nothing yet" /> : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
          {data.items.map((n) => (
            <li key={n.id} className={clsx('p-4 text-sm', !n.readAt && 'bg-brand-50/50')}>
              <Link href={n.link ?? fallbackHref} onClick={() => { if (!n.readAt) void api.put(`/notifications/${n.id}/read`); }} className="font-semibold text-ink hover:text-brand-600">{n.title}</Link>
              <p className="text-muted">{n.message}</p>
              <p className="mt-0.5 text-xs text-muted">{timeAgo(n.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
    </>
  );
}
