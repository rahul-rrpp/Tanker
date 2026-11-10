'use client';

import { use, useState } from 'react';
import { ActionButton, NegotiationTimeline, PromptModal } from '@/components/transporter/ui';
import { DemoBadge, ErrorBlock, KV, LoadingBlock, PageHeader, SectionTitle, StatusBadge, useToast } from '@/components/ui/kit';
import { Button, Card } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateTimeIST, inr } from '@/lib/format';
import { MY_OFFER_STATUS, useRealtime } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

type Data = {
  offer: { id: string; status: string; bookingCode: string; company: string; product: string; pickup: string; delivery: string; customerOffer: number; originalCustomerOffer: number; myLatestOffer: number | null; currentAmount: number; expiresAt: string; round: number; tankersAvailable: number; numberOfTankers: number; isDemo: boolean };
  history: { id: string; party: string; action: string; amount: number | null; message: string | null; createdAt: string }[];
  canRespond: boolean; canCounter: boolean; canWithdraw: boolean;
};

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const { data, error, mutate } = useApi<Data>(`/offers/${id}`, { refreshInterval: 20_000 });
  const [counter, setCounter] = useState(false);
  useRealtime(['notification', 'offer:changed'], () => void mutate());
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  const o = data.offer;
  return (
    <>
      <PageHeader title={`Negotiation: ${o.bookingCode}`} subtitle={<>{o.company} {o.isDemo && <DemoBadge />}</>} back={{ href: '/transporter/offers', label: 'My offers' }} actions={<StatusBadge map={MY_OFFER_STATUS} value={o.status} />} />
      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-3"><SectionTitle>History</SectionTitle><NegotiationTimeline items={data.history} /></Card>
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-5">
            <p className="text-sm text-muted">{o.status === 'COUNTERED' ? 'Company’s counter-offer' : 'Price on the table'}</p>
            <p className="text-3xl font-bold text-brand-700 tabular-nums">{inr(o.currentAmount)}</p>
            {['PENDING', 'COUNTERED'].includes(o.status) && <p className="mt-1 text-xs text-orange-700">Valid until {dateTimeIST(o.expiresAt)}</p>}
            <div className="mt-4 space-y-2">
              {data.canRespond && <ActionButton variant="primary" size="md" className="w-full" action={() => api.post(`/offers/${id}/accept`, {})} success="Accepted. The company will confirm." onDone={() => void mutate()} confirm={`Accept ${inr(o.currentAmount)} for this booking? The company confirms next.`}>Accept latest customer offer</ActionButton>}
              {data.canCounter && <Button fullWidth variant="secondary" onClick={() => setCounter(true)}>Submit counter-offer</Button>}
              {data.canRespond && <ActionButton size="md" className="w-full" action={() => api.post(`/offers/${id}/reject`, {})} success="Counter-offer declined" onDone={() => void mutate()} confirm="Decline this counter-offer? This ends your negotiation on this booking.">Reject counter-offer</ActionButton>}
              {data.canWithdraw && <ActionButton variant="danger" size="md" className="w-full" action={() => api.post(`/offers/${id}/withdraw`, {})} success="Offer withdrawn" onDone={() => void mutate()} confirm="Withdraw your offer? You cannot bid on this booking again.">Withdraw offer</ActionButton>}
              {o.status === 'PENDING' && <p className="text-xs text-muted">Waiting for the company to respond.</p>}
            </div>
          </Card>
          <Card className="p-5"><dl className="divide-y divide-line"><KV label="Route">{o.pickup} → {o.delivery}</KV><KV label="Oil type">{o.product}</KV><KV label="Original customer offer">{inr(o.originalCustomerOffer)}</KV><KV label="My latest offer">{inr(o.myLatestOffer)}</KV><KV label="Tankers offered">{o.tankersAvailable} of {o.numberOfTankers}</KV><KV label="Round">{o.round}</KV></dl></Card>
        </div>
      </div>
      <PromptModal open={counter} onClose={() => setCounter(false)} title="Submit counter-offer" label="Enter your freight price" submit="Send counter-offer" type="number" hint={`Must be above the company's ${inr(o.currentAmount)}`} onSubmit={async (v) => { await api.post(`/offers/${id}/counter`, { amount: Number(v) }); toast.success('Counter-offer sent'); void mutate(); }} />
    </>
  );
}
