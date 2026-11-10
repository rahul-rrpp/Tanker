'use client';

import Link from 'next/link';
import { useState } from 'react';
import { TripStatusBadge } from '@/components/portal/bits';
import { EmptyState, ErrorBlock, LoadingBlock, Tabs } from '@/components/ui/kit';
import { Card } from '@/components/ui/primitives';
import { dayOnly } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import type { DriverTrip } from '../dashboard/page';

export default function Page() {
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const { data, error, mutate } = useApi<{ items: DriverTrip[] }>(`/driver/me/trips?scope=${tab}`);
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold text-ink">My trips</h1>
      <Tabs tabs={[{ value: 'active', label: 'Assigned' }, { value: 'history', label: 'History' }]} value={tab} onChange={setTab} />
      {error ? <ErrorBlock error={error} onRetry={() => void mutate()} /> : !data ? <LoadingBlock /> : data.items.length === 0 ? <EmptyState title="No trips" /> : data.items.map((t) => (
        <Link key={t.id} href={`/driver/trips/${t.id}`} className="block">
          <Card className="p-4">
            <div className="flex items-center justify-between gap-2"><strong className="text-sm">{t.tripCode}</strong><TripStatusBadge status={t.status} /></div>
            <p className="mt-1 text-sm">{t.pickup.city} → {t.delivery.city}</p>
            <p className="text-xs text-muted">{t.tanker?.registrationNumber} · Loading {dayOnly(t.loadingDate)}, {t.loadingTime}</p>
          </Card>
        </Link>
      ))}
    </div>
  );
}
