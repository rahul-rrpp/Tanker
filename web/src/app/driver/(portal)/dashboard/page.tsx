'use client';

import { CalendarClock, MapPin, Truck } from 'lucide-react';
import Link from 'next/link';
import { TripStatusBadge } from '@/components/portal/bits';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui/kit';
import { Alert, Button, Card } from '@/components/ui/primitives';
import { dayOnly } from '@/lib/format';
import { useRealtime } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

export type DriverTrip = { id: string; tripCode: string; status: string; exception: string | null; bookingCode: string; product: string; quantityKl: number; loadingDate: string; loadingTime: string; expectedDeliveryDate: string; pickup: { address: string; city: string; lat: number; lng: number }; delivery: { address: string; city: string; lat: number; lng: number }; tanker: { registrationNumber: string; capacityKl: number; compartments: number } | null; loadingContact: { name: string; phone: string }; deliveryContact: { name: string; phone: string }; loadingInstructions: string | null; deliveryInstructions: string | null; routePolyline: string | null; nextAction: string | null; locationSharingAllowed: boolean; lastGpsAt: string | null };
type Me = { driver: { fullName: string; verificationStatus: string; transporter: string; assignedTanker: { registrationNumber: string } | null }; currentTrip: DriverTrip | null; upcoming: number };

export default function Page() {
  const { data, error, mutate } = useApi<Me>('/driver/me', { refreshInterval: 30_000 });
  useRealtime(['notification', 'trip:status'], () => void mutate());
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock rows={5} />;
  const t = data.currentTrip;
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-ink">Hello, {data.driver.fullName.split(' ')[0]}</h1><p className="text-sm text-muted">{data.driver.transporter}{data.driver.assignedTanker ? ` · ${data.driver.assignedTanker.registrationNumber}` : ''}</p></div>
      {data.driver.verificationStatus !== 'APPROVED' && <Alert tone="info" title="Verification in progress">You can be assigned trips once your documents are verified.</Alert>}
      {!t ? <EmptyState title="No trip assigned">Your next trip appears here.</EmptyState> : (
        <Card className="p-4">
          <div className="flex items-center justify-between"><p className="text-sm font-semibold">Current trip · {t.tripCode}</p><TripStatusBadge status={t.status} /></div>
          <p className="mt-3 flex gap-2 text-sm"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden /><span><strong>Pickup:</strong> {t.pickup.address}</span></p>
          <p className="mt-2 flex gap-2 text-sm"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden /><span><strong>Delivery:</strong> {t.delivery.address}</span></p>
          <p className="mt-2 flex gap-2 text-sm"><Truck className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />{t.tanker?.registrationNumber} · {t.product}</p>
          <p className="mt-2 flex gap-2 text-sm"><CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />Loading {dayOnly(t.loadingDate)}, {t.loadingTime}</p>
          <Link href={`/driver/trips/${t.id}`}><Button fullWidth className="mt-4">Open trip</Button></Link>
        </Card>
      )}
      {data.upcoming > 1 && <Link className="block text-center text-sm font-semibold text-brand-600" href="/driver/trips">{data.upcoming - 1} more assigned</Link>}
    </div>
  );
}
