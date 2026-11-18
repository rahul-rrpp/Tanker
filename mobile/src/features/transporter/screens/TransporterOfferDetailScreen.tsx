import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { ENDPOINTS } from '@/services/api';
import { ActionButton, PromptModal, QueryState } from '@/components/common';
import { Banner, Button, Card, InfoCard, Pill, SectionTitle, SummaryCard } from '@/components/ui';
import { Page } from '@/components/layout';
import { toneFor } from '@/utils/status';
import { dateTime, humanize, inr } from '@/utils/format';
import { colors } from '@/theme';
import { useQuery } from '@/hooks';
import { OFFER_LABEL } from '@/features/transporter/constants';
import { offersService } from '@/services/domain/offersService';

type D = { offer: { id: string; status: string; bookingCode: string; company: string; pickup: string; delivery: string; currentAmount: number; originalCustomerOffer: number; myLatestOffer: number | null; expiresAt: string; round: number; tankersAvailable: number; numberOfTankers: number }; history: { id: string; party: string; action: string; amount: number | null; message: string | null; createdAt: string }[]; canRespond: boolean; canCounter: boolean; canWithdraw: boolean };

/** The transporter's private negotiation with one company. */
export default function TransporterOfferDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery<D>(ENDPOINTS.offers.detail(id), { pollMs: 20_000 });
  const [counter, setCounter] = useState(false);
  const d = q.data;
  return (
    <Page title="Negotiation" subtitle={d ? d.offer.company : undefined} refreshing={q.refreshing} onRefresh={q.refresh}>
      <Stack.Screen options={{ title: 'Negotiation' }} />
      <QueryState loading={q.loading} error={q.error} onRetry={q.reload} skeleton="detail" />
      {d ? (
        <>
          <SummaryCard
            code={d.offer.bookingCode}
            status={<Pill label={OFFER_LABEL[d.offer.status] ?? d.offer.status} tone={toneFor(d.offer.status)} />}
            from={d.offer.pickup}
            to={d.offer.delivery}
            amountLabel={d.offer.status === 'COUNTERED' ? "Company's counter-offer" : 'Price on the table'}
            amount={inr(d.offer.currentAmount)}
            amountNote={['PENDING', 'COUNTERED'].includes(d.offer.status) ? `Valid until ${dateTime(d.offer.expiresAt)}` : undefined}
          />
          <InfoCard
            items={[
              { icon: 'pricetag-outline', label: 'Customer offer', value: inr(d.offer.originalCustomerOffer) },
              { icon: 'person-outline', label: 'My latest', value: inr(d.offer.myLatestOffer) },
              { icon: 'bus-outline', label: 'Tankers', value: `${d.offer.tankersAvailable} of ${d.offer.numberOfTankers}` },
              { icon: 'repeat-outline', label: 'Round', value: d.offer.round },
            ]}
          />
          {d.canRespond ? <ActionButton title={`Accept ${inr(d.offer.currentAmount)}`} icon="checkmark-circle-outline" action={() => offersService.accept(id, {})} success="Accepted. The company confirms next." onDone={q.reload} confirm={`Accept ${inr(d.offer.currentAmount)}?`} /> : null}
          {d.canCounter ? <Button title="Counter-offer" icon="swap-horizontal-outline" variant="secondary" onPress={() => setCounter(true)} /> : null}
          {d.canRespond ? <ActionButton title="Reject counter-offer" icon="close-circle-outline" variant="secondary" action={() => offersService.reject(id, {})} success="Counter-offer declined" onDone={q.reload} confirm="This ends your negotiation on this booking." /> : null}
          {d.canWithdraw ? <ActionButton title="Withdraw offer" icon="arrow-undo-outline" variant="danger" action={() => offersService.withdraw(id, {})} success="Offer withdrawn" onDone={q.reload} confirm="Withdraw? You cannot bid on this booking again." /> : null}
          {d.offer.status === 'PENDING' ? <Banner tone="info">Waiting for the company to respond.</Banner> : null}
          <SectionTitle>Conversation</SectionTitle>
          <Card style={{ gap: 10 }}>
            {d.history.map((h) => {
              const mine = h.party === 'TRANSPORTER';
              return (
                <View key={h.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '85%', backgroundColor: mine ? colors.brand600 : colors.canvas, borderRadius: 18, borderBottomRightRadius: mine ? 6 : 18, borderBottomLeftRadius: mine ? 18 : 6, paddingVertical: 10, paddingHorizontal: 14 }}>
                  <Text style={{ color: mine ? colors.brand100 : colors.muted, fontSize: 12, fontWeight: '600' }}>{mine ? 'You' : humanize(h.party)} · {humanize(h.action)}</Text>
                  {h.amount !== null ? <Text style={{ color: mine ? colors.white : colors.ink, fontWeight: '800', fontSize: 18, marginTop: 2 }}>{inr(h.amount)}</Text> : null}
                  {h.message ? <Text style={{ color: mine ? colors.white : colors.ink, marginTop: 2 }}>{h.message}</Text> : null}
                  <Text style={{ color: mine ? colors.brandTint : colors.muted, fontSize: 11, marginTop: 4 }}>{dateTime(h.createdAt)}</Text>
                </View>
              );
            })}
          </Card>
          <PromptModal visible={counter} title="Counter-offer" label="Your price (₹)" keyboard="numeric" submit="Send" hint={`Must be above ${inr(d.offer.currentAmount)}`} onClose={() => setCounter(false)} onSubmit={async (v) => { await offersService.counter(id, Number(v)); void q.reload(); }} />
        </>
      ) : null}
    </Page>
  );
}
