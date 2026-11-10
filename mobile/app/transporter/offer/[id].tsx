import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '@/api/client';
import { ActionButton, Card, Page, Pill, PromptModal, QueryState, Row, SectionTitle, toneFor } from '@/components/kit';
import { Button } from '@/components/ui';
import { dateTime, humanize, inr } from '@/lib/format';
import { colors } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';
import { OFFER_LABEL } from '../(tabs)/offers';

type D = { offer: { id: string; status: string; bookingCode: string; company: string; pickup: string; delivery: string; currentAmount: number; originalCustomerOffer: number; myLatestOffer: number | null; expiresAt: string; round: number; tankersAvailable: number; numberOfTankers: number }; history: { id: string; party: string; action: string; amount: number | null; message: string | null; createdAt: string }[]; canRespond: boolean; canCounter: boolean; canWithdraw: boolean };

/** The transporter's private negotiation with one company. */
export default function Offer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery<D>(`/offers/${id}`, { pollMs: 20_000 });
  const [counter, setCounter] = useState(false);
  const d = q.data;
  return (
    <Page title={d ? `${d.offer.pickup} → ${d.offer.delivery}` : 'Offer'} subtitle={d ? `${d.offer.bookingCode} · ${d.offer.company}` : undefined} refreshing={q.refreshing} onRefresh={q.refresh}>
      <Stack.Screen options={{ title: 'Negotiation' }} />
      <QueryState loading={q.loading} error={q.error} onRetry={q.reload} />
      {d ? (
        <>
          <Pill label={OFFER_LABEL[d.offer.status] ?? d.offer.status} tone={toneFor(d.offer.status)} />
          <Card>
            <Text style={{ color: colors.muted }}>{d.offer.status === 'COUNTERED' ? "Company's counter-offer" : 'Price on the table'}</Text>
            <Text style={{ fontSize: 26, fontWeight: '800', color: colors.brand700 }}>{inr(d.offer.currentAmount)}</Text>
            <Row label="Original customer offer" value={inr(d.offer.originalCustomerOffer)} />
            <Row label="My latest" value={inr(d.offer.myLatestOffer)} />
            <Row label="Tankers" value={`${d.offer.tankersAvailable} of ${d.offer.numberOfTankers}`} />
            <Row label="Round" value={d.offer.round} />
            {['PENDING', 'COUNTERED'].includes(d.offer.status) ? <Row label="Valid until" value={dateTime(d.offer.expiresAt)} /> : null}
          </Card>
          {d.canRespond ? <ActionButton title={`Accept ${inr(d.offer.currentAmount)}`} action={() => api.post(`/offers/${id}/accept`, {})} success="Accepted. The company confirms next." onDone={q.reload} confirm={`Accept ${inr(d.offer.currentAmount)}?`} /> : null}
          {d.canCounter ? <Button title="Counter-offer" variant="secondary" onPress={() => setCounter(true)} /> : null}
          {d.canRespond ? <ActionButton title="Reject counter-offer" variant="secondary" action={() => api.post(`/offers/${id}/reject`, {})} success="Counter-offer declined" onDone={q.reload} confirm="This ends your negotiation on this booking." /> : null}
          {d.canWithdraw ? <ActionButton title="Withdraw offer" variant="danger" action={() => api.post(`/offers/${id}/withdraw`, {})} success="Offer withdrawn" onDone={q.reload} confirm="Withdraw? You cannot bid on this booking again." /> : null}
          {d.offer.status === 'PENDING' ? <Text style={{ color: colors.muted }}>Waiting for the company to respond.</Text> : null}
          <SectionTitle>History</SectionTitle>
          {d.history.map((h) => (
            <View key={h.id} style={{ alignSelf: h.party === 'TRANSPORTER' ? 'flex-end' : 'flex-start', maxWidth: '85%', backgroundColor: h.party === 'TRANSPORTER' ? colors.brand600 : colors.surface, borderRadius: 14, padding: 10, borderWidth: 1, borderColor: colors.line }}>
              <Text style={{ color: h.party === 'TRANSPORTER' ? '#fff' : colors.muted, fontSize: 12 }}>{h.party === 'TRANSPORTER' ? 'You' : humanize(h.party)} · {humanize(h.action)}</Text>
              {h.amount !== null ? <Text style={{ color: h.party === 'TRANSPORTER' ? '#fff' : colors.ink, fontWeight: '800', fontSize: 16 }}>{inr(h.amount)}</Text> : null}
              {h.message ? <Text style={{ color: h.party === 'TRANSPORTER' ? '#fff' : colors.ink }}>{h.message}</Text> : null}
              <Text style={{ color: h.party === 'TRANSPORTER' ? '#dbeafe' : colors.muted, fontSize: 11 }}>{dateTime(h.createdAt)}</Text>
            </View>
          ))}
          <PromptModal visible={counter} title="Counter-offer" label="Your price (₹)" keyboard="numeric" submit="Send" hint={`Must be above ${inr(d.offer.currentAmount)}`} onClose={() => setCounter(false)} onSubmit={async (v) => { await api.post(`/offers/${id}/counter`, { amount: Number(v) }); void q.reload(); }} />
        </>
      ) : null}
    </Page>
  );
}
