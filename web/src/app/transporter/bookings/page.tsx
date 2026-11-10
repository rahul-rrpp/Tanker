'use client';

import { Phone, Route } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { BookingStatusBadge, TripStatusBadge } from '@/components/portal/bits';
import { MapView } from '@/components/maps/MapView';
import { FileLinks } from '@/components/transporter/ui';
import { DemoBadge, EmptyState, ErrorBlock, LoadingBlock, Modal, PageHeader, useToast } from '@/components/ui/kit';
import { Button, Card, SelectField } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dayOnly, inr, kl, km } from '@/lib/format';
import { useRealtime, type Paged } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

type Loc = { city: string; address: string; latitude: string; longitude: string };
type Trip = { id: string; tripCode: string; status: string; tanker: { id: string; registrationNumber: string } | null; driver: { id: string; user: { fullName: string } } | null };
type Row = { allocationId: string; id: string; bookingCode: string; status: string; isDemo: boolean; company: { name: string; contactPersonName: string; contactPhone: string }; product: { name: string }; pickup: Loc; delivery: Loc; tankerCapacityKl: number; agreedFreight: number; loadingDate: string; loadingTime: string; expectedDeliveryDate: string; loadingContactName: string; loadingContactPhone: string; trips: Trip[]; vehicleAssigned: number; driverAssigned: number; tankersAllocated: number; routePolyline: string | null; distanceKm: number };

const ll = (l: Loc) => ({ lat: Number(l.latitude), lng: Number(l.longitude) });

function AssignModal({ row, trip, kind, onClose, onDone }: { row: Row; trip: Trip; kind: 'tanker' | 'driver'; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data: tankers } = useApi<Paged<{ id: string; registrationNumber: string; capacityKl: number; status: string; verificationStatus: string }>>(kind === 'tanker' ? '/tankers?pageSize=100' : null);
  const { data: drivers } = useApi<Paged<{ id: string; fullName: string; verificationStatus: string; isActive: boolean }>>(kind === 'driver' ? '/transporters/me/drivers?pageSize=100' : null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/bookings/${row.id}/assign-${kind}`, { tripId: trip.id, [`${kind}Id`]: value });
      toast.success(kind === 'tanker' ? 'Tanker assigned' : 'Driver assigned');
      onDone();
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Assign ${kind} to ${trip.tripCode}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!value || busy} onClick={() => void save()}>Assign</Button></>}>
      <SelectField label={kind === 'tanker' ? 'Tanker' : 'Driver'} value={value} onChange={(e) => setValue(e.target.value)} hint="Compliance, availability and overlaps are checked when you assign.">
        <option value="">Select…</option>
        {kind === 'tanker' ? tankers?.items.filter((t) => t.verificationStatus === 'APPROVED').map((t) => <option key={t.id} value={t.id}>{t.registrationNumber} · {t.capacityKl} KL · {t.status.toLowerCase()}</option>) : drivers?.items.filter((d) => d.verificationStatus === 'APPROVED' && d.isActive).map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
      </SelectField>
    </Modal>
  );
}

export default function Page() {
  const { data, error, mutate } = useApi<Paged<Row>>('/transporters/me/bookings?pageSize=100');
  const [assign, setAssign] = useState<{ row: Row; trip: Trip; kind: 'tanker' | 'driver' } | null>(null);
  const [route, setRoute] = useState<Row | null>(null);
  const [contact, setContact] = useState<Row | null>(null);
  useRealtime(['notification', 'trip:status'], () => void mutate());
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  return (
    <>
      <PageHeader title="Confirmed bookings" subtitle="Assign a tanker, then a driver, to each trip" />
      {data.items.length === 0 ? <EmptyState title="No confirmed bookings yet">When a company accepts your offer, the booking appears here.</EmptyState> : (
        <div className="space-y-4">
          {data.items.map((b) => (
            <Card key={b.allocationId} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-muted">{b.bookingCode} {b.isDemo && <DemoBadge />}</p>
                  <p className="text-lg font-bold text-ink">{b.pickup.city} → {b.delivery.city}</p>
                  <p className="text-sm text-muted">{b.company.name} · {b.product.name} · {kl(b.tankerCapacityKl)}</p>
                </div>
                <div className="text-right"><p className="text-xl font-bold tabular-nums text-brand-700">{inr(b.agreedFreight)}</p><p className="text-xs text-muted">Agreed freight</p><div className="mt-1"><BookingStatusBadge status={b.status} /></div></div>
              </div>
              <p className="mt-3 text-sm text-ink">Loading {dayOnly(b.loadingDate)}, {b.loadingTime} · Delivery by {dayOnly(b.expectedDeliveryDate)} · Vehicles {b.vehicleAssigned}/{b.tankersAllocated} · Drivers {b.driverAssigned}/{b.tankersAllocated}</p>
              <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
                {b.trips.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                    <Link href={`/transporter/trips/${t.id}`} className="font-semibold text-brand-600">{t.tripCode}</Link>
                    <TripStatusBadge status={t.status} />
                    <span className="min-w-0 flex-1 text-muted">{t.tanker?.registrationNumber ?? 'No tanker'} · {t.driver?.user.fullName ?? 'No driver'}</span>
                    <Button size="sm" variant="secondary" onClick={() => setAssign({ row: b, trip: t, kind: 'tanker' })}>{t.tanker ? 'Change tanker' : 'Assign tanker'}</Button>
                    <Button size="sm" variant="secondary" disabled={!t.tanker} onClick={() => setAssign({ row: b, trip: t, kind: 'driver' })}>{t.driver ? 'Change driver' : 'Assign driver'}</Button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setRoute(b)}><Route className="h-4 w-4" aria-hidden /> View route</Button>
                <Button size="sm" variant="secondary" onClick={() => setContact(b)}><Phone className="h-4 w-4" aria-hidden /> Contact company</Button>
                <span className="text-xs text-muted">Confirmation:</span><FileLinks path={`/transporters/me/allocations/${b.allocationId}/confirmation.pdf`} />
              </div>
            </Card>
          ))}
        </div>
      )}
      {assign && <AssignModal {...assign} onClose={() => setAssign(null)} onDone={() => void mutate()} />}
      <Modal open={Boolean(route)} size="lg" onClose={() => setRoute(null)} title={route ? `${route.pickup.city} to ${route.delivery.city} · ${km(route.distanceKm)}` : ''}>{route && <MapView className="h-96" pickup={ll(route.pickup)} delivery={ll(route.delivery)} routes={route.routePolyline ? [{ polyline: route.routePolyline }] : []} fitKey={route.id} />}</Modal>
      <Modal open={Boolean(contact)} onClose={() => setContact(null)} title="Contact company">{contact && <div className="space-y-2 text-sm"><p><strong>{contact.company.contactPersonName}</strong> · <a className="text-brand-600" href={`tel:${contact.company.contactPhone}`}>{contact.company.contactPhone}</a></p><p>Loading contact: {contact.loadingContactName} · <a className="text-brand-600" href={`tel:${contact.loadingContactPhone}`}>{contact.loadingContactPhone}</a></p></div>}</Modal>
    </>
  );
}
