'use client';

import { Check } from 'lucide-react';
import { ActionButton, DataTable } from '@/components/transporter/ui';
import { ErrorBlock, LoadingBlock, PageHeader, SectionTitle } from '@/components/ui/kit';
import { Alert, Badge, Card } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateIST, humanize, inr } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type Plan = { id: string; name: string; price: number; validityDays: number; features: string[] };
type Sub = { id: string; subscriptionCode: string; status: string; startAt: string; endAt: string; amount: string; plan: { id?: string; code: string; name: string } };
type S = { id: string; name: string; category: string; description: string | null; availability: string; requiresLicensedPartner: boolean };
type R = { id: string; orderCode: string; requestType: string; status: string; createdAt: string; service: { name: string } };

export default function Page() {
  const { data: plans, error } = useApi<{ plans: Plan[] }>('/subscription-plans');
  const { data: sub, mutate: ms } = useApi<{ current: Sub | null; pending: Sub | null; history: Sub[] }>('/transporters/me/subscription');
  const { data: services } = useApi<{ services: S[] }>('/services');
  const { data: reqs, mutate: mr } = useApi<{ items: R[] }>('/service-requests');
  if (error) return <ErrorBlock error={error} />;
  if (!plans) return <LoadingBlock rows={6} />;
  const request = (serviceId: string, requestType: string) => api.post('/service-requests', { serviceId, requestType });
  return (
    <>
      <PageHeader title="Subscription & services" subtitle={sub?.current ? `${sub.current.plan.name} plan, renews ${dateIST(sub.current.endAt)}` : 'No active plan'} />
      {sub?.pending && <div className="mb-4"><Alert tone="info" title={`${sub.pending.plan.name} plan requested`}>Our team will contact you to complete payment, and the plan starts once it is confirmed.</Alert></div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.plans.map((p) => {
          const current = sub?.current?.plan.name === p.name;
          return (
            <Card key={p.id} className="flex flex-col p-5">
              <p className="flex items-center justify-between text-lg font-bold text-ink">{p.name}{current && <Badge tone="success">Current</Badge>}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{p.price === 0 ? 'Free' : inr(p.price)}</p>
              <p className="text-xs text-muted">Valid {p.validityDays} days</p>
              <ul className="my-4 flex-1 space-y-1.5 text-sm">{p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden />{f}</li>)}</ul>
              <ActionButton variant={current ? 'secondary' : 'primary'} size="md" className="w-full" disabled={Boolean(sub?.pending) || (current && p.price === 0)} action={() => api.post('/transporters/me/subscription-orders', { planId: p.id })} success={p.price === 0 ? 'Plan activated' : 'Plan requested'} onDone={() => void ms()}>{current ? 'Renew' : 'Select plan'}</ActionButton>
            </Card>
          );
        })}
      </div>
      {sub && sub.history.length > 0 && <section className="mt-8"><SectionTitle>Subscription history</SectionTitle><DataTable rows={sub.history} rowKey={(x) => x.id} columns={[{ key: 'c', label: 'Reference', render: (x) => x.subscriptionCode }, { key: 'p', label: 'Plan', render: (x) => x.plan.name }, { key: 'a', label: 'Amount', render: (x) => inr(x.amount) }, { key: 's', label: 'Status', render: (x) => humanize(x.status) }, { key: 'f', label: 'From', render: (x) => dateIST(x.startAt) }, { key: 't', label: 'To', render: (x) => dateIST(x.endAt) }]} /></section>}
      <section className="mt-8">
        <SectionTitle>Additional services</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {services?.services.map((s) => (
            <Card key={s.id} className="flex flex-col p-4">
              <p className="font-semibold text-ink">{s.name}</p><p className="text-xs text-muted">{humanize(s.category)}{s.requiresLicensedPartner ? ' · through a licensed partner' : ''}</p>
              {s.description && <p className="mt-2 flex-1 text-sm">{s.description}</p>}
              <div className="mt-3 flex gap-2"><ActionButton action={() => request(s.id, 'ENQUIRY')} success="Enquiry submitted" onDone={() => void mr()}>Submit enquiry</ActionButton><ActionButton action={() => request(s.id, 'CALLBACK')} success="Callback requested" onDone={() => void mr()}>Request callback</ActionButton></div>
            </Card>
          ))}
        </div>
      </section>
      {reqs && reqs.items.length > 0 && <section className="mt-8"><SectionTitle>Service requests</SectionTitle><DataTable rows={reqs.items} rowKey={(x) => x.id} columns={[{ key: 'c', label: 'Reference', render: (x) => x.orderCode }, { key: 's', label: 'Service', render: (x) => x.service.name }, { key: 't', label: 'Type', render: (x) => humanize(x.requestType) }, { key: 'st', label: 'Status', render: (x) => humanize(x.status) }, { key: 'd', label: 'Requested', render: (x) => dateIST(x.createdAt) }]} /></section>}
    </>
  );
}
