'use client';

import { Navigation, Phone, Search, Truck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { TripStatusBadge } from '@/components/portal/bits';
import { DemoBadge, EmptyState, ErrorBlock, LoadingBlock, PageHeader, Tabs } from '@/components/ui/kit';
import { Card } from '@/components/ui/primitives';
import type { Trip } from '@/lib/company-types';
import { dayOnly, km } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type Scope = 'active' | 'completed' | 'all';

export default function TripsPage() {
  const [scope, setScope] = useState<Scope>('active');
  const [q, setQ] = useState('');
  const { data, error, isLoading, mutate } = useApi<{ trips: Trip[] }>(`/trips?scope=${scope}`, { refreshInterval: 30_000 });
  const needle = q.trim().toLowerCase();
  const trips = (data?.trips ?? []).filter(
    (t) =>
      !needle ||
      [t.tripCode, t.booking.bookingCode, t.tanker?.registrationNumber, t.transporter.companyName, t.driver?.user.fullName, t.pickup?.city, t.delivery?.city].some((v) => (v ?? '').toLowerCase().includes(needle)),
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Active Trips" subtitle="Confirmed bookings from vehicle assignment to delivery. Open a trip for live tracking." />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <Tabs
          tabs={[
            { value: 'active', label: 'Active' },
            { value: 'completed', label: 'Delivered' },
            { value: 'all', label: 'All trips' },
          ]}
          value={scope}
          onChange={setScope}
        />
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search booking, tanker, driver, city" aria-label="Search trips" className="h-10 w-full rounded-[var(--radius-field)] border border-line bg-white pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100" />
        </div>
      </div>
      {error ? (
        <ErrorBlock error={error} onRetry={() => mutate()} />
      ) : isLoading || !data ? (
        <LoadingBlock />
      ) : trips.length === 0 ? (
        <EmptyState title={scope === 'active' ? 'No active trips' : 'No trips'} icon={<Truck className="h-6 w-6" />}>
          {needle ? 'No trips match your search.' : 'Trips are created when you accept a transporter offer.'}
        </EmptyState>
      ) : (
        <Card className="!p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">Booking ID</th>
                  <th className="px-3 py-3 font-medium">Tanker number</th>
                  <th className="px-3 py-3 font-medium">Transporter</th>
                  <th className="px-3 py-3 font-medium">Driver</th>
                  <th className="px-3 py-3 font-medium">Pickup</th>
                  <th className="px-3 py-3 font-medium">Delivery</th>
                  <th className="px-3 py-3 font-medium">Trip status</th>
                  <th className="px-3 py-3 font-medium">Expected delivery</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {trips.map((t) => {
                  const progress = t.plannedDistanceKm > 0 ? Math.min(100, Math.round((t.distanceTravelledKm / t.plannedDistanceKm) * 100)) : 0;
                  return (
                    <tr key={t.id} className="border-b border-line last:border-0 hover:bg-canvas/60">
                      <td className="px-4 py-3">
                        <Link href={`/company/bookings/${t.booking.id}`} className="font-semibold text-brand-700 hover:underline">
                          {t.booking.bookingCode}
                        </Link>
                        <p className="flex items-center gap-1.5 text-xs text-muted">
                          {t.tripCode} {t.isSimulated && <DemoBadge label="Simulated" />}
                        </p>
                      </td>
                      <td className="px-3 py-3 font-medium">{t.tanker?.registrationNumber ?? <span className="font-normal text-muted">To be assigned</span>}</td>
                      <td className="px-3 py-3">{t.transporter.companyName}</td>
                      <td className="px-3 py-3">
                        {t.driver ? (
                          <>
                            {t.driver.user.fullName}
                            <p className="text-xs text-muted">+91 {t.driver.user.phone}</p>
                          </>
                        ) : (
                          <span className="text-muted">To be assigned</span>
                        )}
                      </td>
                      <td className="max-w-[160px] px-3 py-3">
                        <p className="font-medium">{t.pickup?.city ?? '—'}</p>
                        <p className="truncate text-xs text-muted" title={t.pickup?.address}>{t.pickup?.address}</p>
                      </td>
                      <td className="max-w-[160px] px-3 py-3">
                        <p className="font-medium">{t.delivery?.city ?? '—'}</p>
                        <p className="truncate text-xs text-muted" title={t.delivery?.address}>{t.delivery?.address}</p>
                      </td>
                      <td className="px-3 py-3">
                        <TripStatusBadge status={t.status} />
                        {t.status === 'IN_TRANSIT' && (
                          <p className="mt-1 text-xs text-muted">
                            {progress}% · {km(t.distanceTravelledKm)}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3">{dayOnly(t.booking.expectedDeliveryDate)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Link href={`/company/trips/${t.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-2.5 text-xs font-semibold text-white hover:bg-brand-700">
                            <Navigation className="h-3.5 w-3.5" /> Track
                          </Link>
                          {t.driver && (
                            <a href={`tel:+91${t.driver.user.phone}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-semibold text-ink hover:bg-canvas" aria-label={`Call ${t.driver.user.fullName}`}>
                              <Phone className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
