'use client';

import { ArrowRight, Clock, Truck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ActionButton } from '@/components/transporter/ui';
import { DemoBadge, EmptyState, ErrorBlock, LoadingBlock, PageHeader, Pagination } from '@/components/ui/kit';
import { Alert, Button, Card, SelectField, TextField } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import type { Catalog } from '@/lib/company-types';
import { dateTimeIST, dayOnly, duration, inr, kl, km } from '@/lib/format';
import { useRealtime } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

export type MarketCard = { id: string; bookingCode: string; pickupCity: string; deliveryCity: string; pickupAddress: string; deliveryAddress: string; distanceKm: number; durationMinutes: number; product: string; quantityKl: number; tankerCapacityKl: number; numberOfTankers: number; remainingTankers: number; loadingDate: string; loadingTime: string; customerOffer: number; offerExpiresAt: string; availableTankers: number; nearestTankerApproxKm: number | null; isDemo: boolean };
type Resp = { total: number; page: number; pageSize: number; items: MarketCard[]; canBid: boolean };

const EMPTY = { pickupCity: '', deliveryCity: '', route: '', productId: '', capacity: '', minDistance: '', maxDistance: '', minOffer: '', maxOffer: '', from: '', to: '', minAvailable: '' };

export default function Page() {
  const [draft, setDraft] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams(Object.entries({ ...applied, page: String(page) }).filter(([, v]) => v)).toString();
  const { data, error, mutate } = useApi<Resp>(`/marketplace/bookings?${qs}`, { refreshInterval: 60_000 });
  const { data: catalog } = useApi<Catalog>('/catalog', { revalidateOnFocus: false });
  useRealtime(['offer:changed'], () => void mutate());
  const bind = (k: keyof typeof EMPTY) => ({ value: draft[k], onChange: (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value })) });

  return (
    <>
      <PageHeader title="Available bookings" subtitle="Only bookings your verified, compatible and free tankers can serve" />
      <Card className="mb-5 p-4">
        <form className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(draft); }}>
          <TextField label="Pickup city" {...bind('pickupCity')} />
          <TextField label="Delivery city" {...bind('deliveryCity')} />
          <TextField label="Route" {...bind('route')} />
          <SelectField label="Oil type" {...bind('productId')}><option value="">Any</option>{catalog?.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectField>
          <TextField label="Capacity (KL)" type="number" {...bind('capacity')} />
          <TextField label="Available tankers ≥" type="number" {...bind('minAvailable')} />
          <TextField label="Distance from (km)" type="number" {...bind('minDistance')} />
          <TextField label="Distance to (km)" type="number" {...bind('maxDistance')} />
          <TextField label="Offer from (₹)" type="number" {...bind('minOffer')} />
          <TextField label="Offer to (₹)" type="number" {...bind('maxOffer')} />
          <TextField label="Loading from" type="date" {...bind('from')} />
          <TextField label="Loading to" type="date" {...bind('to')} />
          <div className="col-span-2 flex gap-2 md:col-span-4 lg:col-span-6">
            <Button type="submit" size="sm">Search</Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => { setDraft(EMPTY); setApplied(EMPTY); setPage(1); }}>Clear</Button>
          </div>
        </form>
      </Card>
      {error ? <ErrorBlock error={error} onRetry={() => void mutate()} /> : !data ? <LoadingBlock rows={6} /> : (
        <>
          {!data.canBid && <div className="mb-4"><Alert tone="info" title="Bidding opens after verification">Complete your profile, documents and fleet so our team can verify your account.</Alert></div>}
          {data.items.length === 0 ? <EmptyState title="No matching bookings">Change the filters, or check that your tankers are verified and free for upcoming dates.</EmptyState> : (
            <div className="grid gap-4 lg:grid-cols-2">
              {data.items.map((b) => (
                <Card key={b.id} className="flex flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted">{b.bookingCode} {b.isDemo && <DemoBadge />}</p>
                      <p className="mt-1 flex items-center gap-2 text-lg font-bold text-ink">{b.pickupCity} <ArrowRight className="h-4 w-4 text-muted" aria-hidden /> {b.deliveryCity}</p>
                      <p className="mt-0.5 truncate text-xs text-muted">{b.pickupAddress} → {b.deliveryAddress}</p>
                    </div>
                    <div className="shrink-0 text-right"><p className="text-xs text-muted">Customer offer</p><p className="text-xl font-bold text-brand-700 tabular-nums">{inr(b.customerOffer)}</p></div>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                    <div><dt className="text-xs text-muted">Road distance</dt><dd className="font-medium">{km(b.distanceKm)}</dd></div>
                    <div><dt className="text-xs text-muted">Est. travel</dt><dd className="font-medium">{duration(b.durationMinutes)}</dd></div>
                    <div><dt className="text-xs text-muted">Oil type</dt><dd className="font-medium">{b.product}</dd></div>
                    <div><dt className="text-xs text-muted">Quantity</dt><dd className="font-medium">{kl(b.quantityKl)}</dd></div>
                    <div><dt className="text-xs text-muted">Tanker capacity</dt><dd className="font-medium">{kl(b.tankerCapacityKl)}</dd></div>
                    <div><dt className="text-xs text-muted">Tankers needed</dt><dd className="font-medium">{b.remainingTankers} of {b.numberOfTankers}</dd></div>
                    <div><dt className="text-xs text-muted">Loading</dt><dd className="font-medium">{dayOnly(b.loadingDate)}, {b.loadingTime}</dd></div>
                    <div><dt className="text-xs text-muted">Your free tankers</dt><dd className="flex items-center gap-1 font-medium"><Truck className="h-3.5 w-3.5" aria-hidden />{b.availableTankers}</dd></div>
                    <div><dt className="text-xs text-muted">Nearest tanker</dt><dd className="font-medium">{b.nearestTankerApproxKm === null ? '—' : `~${b.nearestTankerApproxKm} km (approx.)`}</dd></div>
                  </dl>
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-orange-700"><Clock className="h-3.5 w-3.5" aria-hidden /> Offers close {dateTimeIST(b.offerExpiresAt)}</p>
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                    <Link href={`/transporter/marketplace/${b.id}`}><Button size="sm">View, accept or counter</Button></Link>
                    <ActionButton action={() => api.post(`/marketplace/bookings/${b.id}/ignore`, {})} success="Booking hidden" onDone={() => void mutate()}>Ignore</ActionButton>
                  </div>
                </Card>
              ))}
            </div>
          )}
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
        </>
      )}
    </>
  );
}
