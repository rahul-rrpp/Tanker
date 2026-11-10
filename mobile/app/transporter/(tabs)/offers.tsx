import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Card, Chips, Page, Pill, QueryState, toneFor } from '@/components/kit';
import { dateTime, inr } from '@/lib/format';
import { colors } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';

type O = { id: string; status: string; bookingCode: string; company: string; pickup: string; delivery: string; customerOffer: number; myLatestOffer: number | null; expiresAt: string };
const TABS = [['all', 'All'], ['pending', 'Pending'], ['counter', 'Counter received'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['expired', 'Expired']] as const;
export const OFFER_LABEL: Record<string, string> = { PENDING: 'Awaiting company', COUNTERED: 'Counter-offer received', ACCEPTED: 'Accepted', REJECTED: 'Rejected', EXPIRED: 'Expired', WITHDRAWN: 'Withdrawn', UNSUCCESSFUL: 'Not selected' };

export default function Offers() {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('all');
  const q = useQuery<{ items: O[]; counts: Record<string, number> }>(`/transporters/me/offers?tab=${tab}&pageSize=50`, { pollMs: 30_000 });
  return (
    <Page title="My offers" refreshing={q.refreshing} onRefresh={q.refresh}>
      <Chips value={tab} options={TABS.map(([value, label]) => ({ value, label: q.data?.counts[value] !== undefined ? `${label} ${q.data.counts[value]}` : label }))} onChange={setTab} />
      <QueryState loading={q.loading} error={q.error} empty={q.data?.items.length === 0} emptyText="No offers here" onRetry={q.reload} />
      {q.data?.items.map((o) => (
        <Card key={o.id} onPress={() => router.push(`/transporter/offer/${o.id}`)}>
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
