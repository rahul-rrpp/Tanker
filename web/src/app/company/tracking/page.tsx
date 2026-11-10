'use client';

import { Navigation } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { TripStatusBadge } from '@/components/portal/bits';
import { DemoBadge, EmptyState, ErrorBlock, LoadingBlock, PageHeader } from '@/components/ui/kit';
import type { Trip } from '@/lib/company-types';
import { km } from '@/lib/format';
import { useApi } from '@/lib/useApi';

/** Live Tracking entry point: opens the single active trip directly, otherwise lets the user choose. */
export default function TrackingPage() {
  const router = useRouter();
  const { data, error, mutate } = useApi<{ trips: Trip[] }>('/trips?scope=active');
  const trips = data?.trips ?? [];
  const moving = trips.filter((t) => ['LOADING', 'IN_TRANSIT'].includes(t.status));

  useEffect(() => {
    if (data && trips.length === 1) router.replace(`/company/trips/${trips[0].id}`);
  }, [data, trips, router]);

  return (
    <div className="space-y-5">
      <PageHeader title="Live Tracking" subtitle="Choose a trip to see the tanker on the map." />
      {error ? (
        <ErrorBlock error={error} onRetry={() => mutate()} />
      ) : !data || trips.length === 1 ? (
        <LoadingBlock />
      ) : trips.length === 0 ? (
        <EmptyState title="No active trips to track" icon={<Navigation className="h-6 w-6" />} action={<Link href="/company/trips?scope=all" className="font-semibold text-brand-600">View all trips</Link>}>
          Tracking becomes available once a booking is confirmed and the tanker starts its trip.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {[...moving, ...trips.filter((t) => !moving.includes(t))].map((t) => (
            <Link key={t.id} href={`/company/trips/${t.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4 hover:border-brand-300">
              <div>
                <p className="flex items-center gap-2 font-semibold text-ink">
                  {t.tripCode} · {t.booking.bookingCode} {t.isSimulated && <DemoBadge label="Simulated" />}
                </p>
                <p className="text-sm text-muted">
                  {t.pickup?.city} → {t.delivery?.city} · {km(t.distanceTravelledKm)} of {km(t.plannedDistanceKm)} · {t.tanker?.registrationNumber ?? 'vehicle pending'}
                </p>
              </div>
              <TripStatusBadge status={t.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
