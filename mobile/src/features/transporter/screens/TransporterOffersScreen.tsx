import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Chips, ListCard, Pill } from '@/components/ui';
import { Page } from '@/components/layout';
import { QueryState } from '@/components/common';
import { toneFor } from '@/utils/status';
import { dateTime, inr } from '@/utils/format';
import { useQuery } from '@/hooks';
import { OFFER_LABEL } from '../constants';
import { ENDPOINTS } from '@/services/api';
import { ROUTES } from '@/navigation/routes';

type O = { id: string; status: string; bookingCode: string; company: string; pickup: string; delivery: string; customerOffer: number; myLatestOffer: number | null; expiresAt: string };
const TABS = [['all', 'All'], ['pending', 'Pending'], ['counter', 'Counter received'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['expired', 'Expired']] as const;

export default function TransporterOffersScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('all');
  const q = useQuery<{ items: O[]; counts: Record<string, number> }>(ENDPOINTS.transporter.offers(tab), { pollMs: 30_000 });
  return (
    <Page title="My offers" subtitle="Your negotiations with companies" refreshing={q.refreshing} onRefresh={q.refresh}>
      <Chips value={tab} options={TABS.map(([value, label]) => ({ value, label: q.data?.counts[value] !== undefined ? `${label} ${q.data.counts[value]}` : label }))} onChange={setTab} />
      <QueryState loading={q.loading} error={q.error} empty={q.data?.items.length === 0} emptyText="No offers here" emptyIcon="pricetags-outline" onRetry={q.reload} />
      {q.data?.items.map((o) => (
        <ListCard
          key={o.id}
          code={`${o.bookingCode} · ${o.company}`}
          status={<Pill label={OFFER_LABEL[o.status] ?? o.status} tone={toneFor(o.status)} />}
          from={o.pickup}
          to={o.delivery}
          amount={inr(o.myLatestOffer)}
          amountLabel="My offer"
          meta={[`Customer offered ${inr(o.customerOffer)}`]}
          note={['PENDING', 'COUNTERED'].includes(o.status) ? `Valid until ${dateTime(o.expiresAt)}` : null}
          onPress={() => router.push(ROUTES.transporter.offer(o.id))}
        />
      ))}
    </Page>
  );
}
