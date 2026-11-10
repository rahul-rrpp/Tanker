'use client';

import { AlertTriangle, Clock, FlaskConical, Gauge, LifeBuoy, MapPin, Phone, Route, Truck } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { MapView } from '@/components/maps/MapView';
import { TripStatusBadge } from '@/components/portal/bits';
import { DemoButton, DemoPanel } from '@/components/portal/DemoPanel';
import { ErrorBlock, KV, LoadingBlock, PageHeader, SectionTitle, useToast } from '@/components/ui/kit';
import { Card } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import type { Tracking, Trip } from '@/lib/company-types';
import { dateTimeIST, km, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/useApi';

export default function TripTrackingPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const trip = useApi<{ trip: Trip }>(`/trips/${id}`);
  const tracking = useApi<{ tracking: Tracking }>(`/trips/${id}/tracking`, { refreshInterval: 15_000 });
  const [advancing, setAdvancing] = useState(false);

  if (trip.error) return <ErrorBlock error={trip.error} onRetry={() => trip.mutate()} />;
  if (!trip.data || !tracking.data) return <LoadingBlock rows={6} />;
  const t = trip.data.trip;
  const tr = tracking.data.tracking;
  const simulated = tr.dataSource === 'SIMULATED';
  const done = ['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(t.status);

  async function advance() {
    setAdvancing(true);
    try {
      const { data } = await api.post(`/demo/trips/${t.id}/advance`);
      toast.success(`Demo trip: ${data.data.to.replace(/_/g, ' ').toLowerCase()}`);
      await Promise.all([trip.mutate(), tracking.mutate()]);
    } catch (e) {
      toast.error(e);
    } finally {
      setAdvancing(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: '/company/trips', label: 'Active Trips' }}
        title={`Tracking ${t.tripCode}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <TripStatusBadge status={t.status} />
            <Link href={`/company/bookings/${t.booking.id}`} className="text-brand-600 hover:underline">
              {t.booking.bookingCode}
            </Link>
            · {t.pickup?.city} → {t.delivery?.city}
          </span>
        }
      />

      {simulated ? (
        <div className="flex items-start gap-3 rounded-2xl border-2 border-fuchsia-300 bg-fuchsia-50 p-4 text-sm text-fuchsia-900" role="note">
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div>
            <p className="font-bold uppercase tracking-wide">Simulated GPS data — not live tracking</p>
            <p className="mt-0.5">{tr.dataSourceLabel}</p>
          </div>
        </div>
      ) : tr.dataSource === 'NONE' ? (
        <div className="flex items-center gap-2 rounded-2xl border border-line bg-white p-4 text-sm text-muted">
          <AlertTriangle className="h-4 w-4" /> No GPS updates yet. The tanker position appears once the trip starts and the vehicle reports its location.
        </div>
      ) : null}

      {!done && t.isSimulated && (
        <DemoPanel title="trip progress">
          <DemoButton onClick={advance} loading={advancing}>
            {t.status === 'IN_TRANSIT' ? 'Simulate next GPS updates (+30% route)' : 'Advance trip to next stage'}
          </DemoButton>
        </DemoPanel>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <MapView
            className="h-[380px] sm:h-[480px]"
            fitKey={t.id}
            pickup={tr.pickup ? { lat: tr.pickup.latitude, lng: tr.pickup.longitude } : null}
            delivery={tr.delivery ? { lat: tr.delivery.latitude, lng: tr.delivery.longitude } : null}
            routes={tr.plannedPolyline ? [{ polyline: tr.plannedPolyline }] : []}
            breadcrumb={tr.breadcrumb}
            vehicle={tr.currentPosition}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { icon: Route, label: 'Distance travelled', value: km(tr.distanceTravelledKm) },
              { icon: MapPin, label: 'Remaining', value: km(tr.remainingDistanceKm) },
              { icon: Clock, label: 'Estimated arrival', value: tr.etaAt ? dateTimeIST(tr.etaAt) : done ? 'Arrived' : '—' },
              { icon: Gauge, label: 'Last GPS update', value: tr.lastGpsAt ? timeAgo(tr.lastGpsAt) : '—' },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="rounded-2xl border border-line bg-white p-3">
                <p className="flex items-center gap-1.5 text-xs text-muted">
                  <Icon className="h-3.5 w-3.5" /> {label}
                  {simulated && label === 'Last GPS update' ? ' (simulated)' : ''}
                </p>
                <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted">
            <span className="mr-3 inline-flex items-center gap-1">
              <span className="h-1 w-4 rounded bg-brand-600" /> Planned route
            </span>
            <span className="mr-3 inline-flex items-center gap-1">
              <span className="h-1 w-4 rounded bg-green-600" /> Travelled{simulated ? ' (simulated)' : ''}
            </span>
            Planned distance {km(tr.plannedDistanceKm)}
          </p>
        </div>

        <div className="space-y-5">
          <Card>
            <SectionTitle>Trip details</SectionTitle>
            <dl className="divide-y divide-line">
              <KV label="Transporter">{t.transporter.companyName}</KV>
              <KV label="Tanker number">{t.tanker?.registrationNumber ?? 'Not yet assigned'}</KV>
              <KV label="Tanker">{t.tanker ? `${t.tanker.capacityKl} KL · ${t.tanker.tankerType.name}` : '—'}</KV>
              <KV label="Driver name">{t.driver?.user.fullName ?? 'Not yet assigned'}</KV>
              <KV label="Driver contact">{t.driver ? `+91 ${t.driver.user.phone}` : '—'}</KV>
              <KV label="Trip status">
                <TripStatusBadge status={t.status} />
              </KV>
              <KV label="Last GPS update">{tr.lastGpsAt ? `${dateTimeIST(tr.lastGpsAt)}${simulated ? ' (simulated)' : ''}` : '—'}</KV>
            </dl>
          </Card>
          <div className="grid gap-2">
            {t.driver ? (
              <a href={`tel:+91${t.driver.user.phone}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-field)] bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700">
                <Phone className="h-4 w-4" /> Call driver
              </a>
            ) : (
              <span className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-field)] bg-canvas text-sm font-medium text-muted">
                <Truck className="h-4 w-4" /> Driver details appear once assigned
              </span>
            )}
            <a href={`tel:+91${t.transporter.contactPhone}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-field)] border border-line bg-white text-sm font-semibold text-ink hover:bg-canvas">
              <Phone className="h-4 w-4" /> Contact transporter
            </a>
            <Link href={`/company/support/new?booking=${t.booking.id}&category=VEHICLE_DELAY`} className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-field)] border border-line bg-white text-sm font-semibold text-danger hover:bg-red-50">
              <LifeBuoy className="h-4 w-4" /> Report issue
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
