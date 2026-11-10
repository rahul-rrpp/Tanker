'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapView } from '@/components/maps/MapView';
import { Modal, KV, ErrorBlock, LoadingBlock, PageHeader, SectionTitle, useToast, DemoBadge } from '@/components/ui/kit';
import { Alert, Button, Card, TextField } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';
import { dateTimeIST, dayOnly, duration, inr, kl, km } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import type { MarketCard } from '../page';

type Detail = {
  booking: MarketCard & { routePolyline: string | null; routeSummary: string | null; company: string; specialRequirements: string | null; suggestedFreight: number; offerId: string | null; pickup: { lat: number; lng: number }; delivery: { lat: number; lng: number }; expectedDeliveryDate: string; routeProvider: string };
  availableTankers: { id: string; registrationNumber: string; capacityKl: number }[];
};

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { data, error, mutate } = useApi<Detail>(`/marketplace/bookings/${id}`);
  const [mode, setMode] = useState<'ACCEPT' | 'COUNTER' | null>(null);
  const [tankers, setTankers] = useState('1');
  const [amount, setAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock rows={6} />;
  const b = data.booking;
  const maxTankers = Math.min(b.remainingTankers, data.availableTankers.length);
  const share = Number(tankers) / b.numberOfTankers;
  const customerShare = Math.round(b.customerOffer * share * 100) / 100;

  async function send() {
    setBusy(true);
    setFail(null);
    try {
      const r = await api.post(`/bookings/${id}/offers`, { mode, tankers: Number(tankers), ...(mode === 'COUNTER' ? { amount: Number(amount) } : {}), ...(remarks.trim() ? { remarks: remarks.trim() } : {}) });
      toast.success(r.data.message);
      router.push(`/transporter/offers/${r.data.data.offerId}`);
    } catch (e) {
      setFail(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={`${b.pickupCity} to ${b.deliveryCity}`} subtitle={<>{b.bookingCode} · {b.company} {b.isDemo && <DemoBadge />}</>} back={{ href: '/transporter/marketplace', label: 'Available bookings' }} />
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <MapView className="h-80" pickup={b.pickup} delivery={b.delivery} routes={b.routePolyline ? [{ polyline: b.routePolyline }] : []} fitKey={b.id} />
          <p className="text-xs text-muted">Road route from {b.routeProvider}: {km(b.distanceKm)}, about {duration(b.durationMinutes)}{b.routeSummary ? ` via ${b.routeSummary}` : ''}.</p>
          <Card className="p-5">
            <SectionTitle>Booking details</SectionTitle>
            <dl className="divide-y divide-line">
              <KV label="Pickup">{b.pickupAddress}</KV><KV label="Delivery">{b.deliveryAddress}</KV><KV label="Oil type">{b.product}</KV><KV label="Quantity">{kl(b.quantityKl)}</KV><KV label="Tanker capacity">{kl(b.tankerCapacityKl)}</KV><KV label="Tankers still needed">{b.remainingTankers} of {b.numberOfTankers}</KV>
              <KV label="Loading">{dayOnly(b.loadingDate)}, {b.loadingTime}</KV><KV label="Expected delivery">{dayOnly(b.expectedDeliveryDate)}</KV><KV label="Offers close">{dateTimeIST(b.offerExpiresAt)}</KV>{b.specialRequirements && <KV label="Special requirements">{b.specialRequirements}</KV>}
            </dl>
          </Card>
        </div>
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-5">
            <p className="text-sm text-muted">Customer offered freight</p>
            <p className="text-3xl font-bold text-brand-700 tabular-nums">{inr(b.customerOffer)}</p>
            <p className="mt-1 text-xs text-muted">Indicative platform freight: {inr(b.suggestedFreight)}</p>
            {b.offerId ? (
              <Link href={`/transporter/offers/${b.offerId}`}><Button fullWidth className="mt-4">View my negotiation</Button></Link>
            ) : (
              <div className="mt-4 space-y-2">
                <Button fullWidth onClick={() => setMode('ACCEPT')}>Accept customer offer</Button>
                <Button fullWidth variant="secondary" onClick={() => setMode('COUNTER')}>Make counter-offer</Button>
                <p className="text-xs text-muted">Accepting submits your offer at this price. The company still has to confirm you.</p>
              </div>
            )}
          </Card>
          <Card className="p-5">
            <SectionTitle>Your compatible free tankers</SectionTitle>
            <ul className="space-y-1.5 text-sm">{data.availableTankers.map((t) => <li key={t.id} className="flex justify-between"><span>{t.registrationNumber}</span><span className="text-muted">{kl(t.capacityKl)}</span></li>)}</ul>
          </Card>
        </div>
      </div>
      <Modal open={mode !== null} onClose={() => setMode(null)} title={mode === 'ACCEPT' ? 'Accept customer offer' : 'Send counter-offer'} footer={<><Button variant="secondary" onClick={() => setMode(null)}>Cancel</Button><Button loading={busy} disabled={busy || (mode === 'COUNTER' && !(Number(amount) > 0))} onClick={() => void send()}>{mode === 'ACCEPT' ? 'Accept offer' : 'Send counter-offer'}</Button></>}>
        <div className="space-y-4">
          {fail && <Alert tone="error">{fail}</Alert>}
          <TextField label={`Tankers you are offering (up to ${maxTankers})`} type="number" min={1} max={maxTankers} value={tankers} onChange={(e) => setTankers(e.target.value)} />
          {mode === 'ACCEPT' ? <p className="text-sm">You will submit <strong>{inr(customerShare)}</strong> for {tankers} of {b.numberOfTankers} tanker(s).</p> : <TextField label="Enter your freight price" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} hint={`Total for the tankers offered. Customer's price for these: ${inr(customerShare)}`} />}
          <TextField label="Remarks (optional)" value={remarks} maxLength={500} onChange={(e) => setRemarks(e.target.value)} />
        </div>
      </Modal>
    </>
  );
}
