import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Card, Chips, Pill } from '@/components/ui';
import { Page } from '@/components/layout';
import { QueryState } from '@/components/common';
import { toneFor } from '@/utils/status';
import { dateTime, inr } from '@/utils/format';
import { colors } from '@/theme';
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
    <Page title="My offers" refreshing={q.refreshing} onRefresh={q.refresh}>
      <Chips value={tab} options={TABS.map(([value, label]) => ({ value, label: q.data?.counts[value] !== undefined ? `${label} ${q.data.counts[value]}` : label }))} onChange={setTab} />
      <QueryState loading={q.loading} error={q.error} empty={q.data?.items.length === 0} emptyText="No offers here" onRetry={q.reload} />
      {q.data?.items.map((o) => (
        <Card key={o.id} onPress={() => router.push(ROUTES.transporter.offer(o.id))}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>{o.pickup} → {o.delivery}</Text>
          <Text style={{ color: colors.muted }}>{o.bookingCode} · {o.company}</Text>
          <Text style={{ color: colors.ink }}>Customer {inr(o.customerOffer)} · mine {inr(o.myLatestOffer)}</Text>
          {['PENDING', 'COUNTERED'].includes(o.status) ? <Text style={{ color: colors.warning, fontSize: 12 }}>Valid until {dateTime(o.expiresAt)}</Text> : null}
          <Pill label={OFFER_LABEL[o.status] ?? o.status} tone={toneFor(o.status)} />
        </Card>
      ))}
    </Page>
  );
}
