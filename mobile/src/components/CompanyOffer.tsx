import { useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../api/client';
import { dateTime, humanize, inr } from '../lib/format';
import { colors } from '../lib/theme';
import { ActionButton, Card, Pill, PromptModal, toneFor } from './kit';
import { Button } from './ui';

export type CompanyOffer = {
  id: string; status: string; currentAmount: string; expiresAt: string; tankersAvailable: number; round: number; isDemo: boolean;
  transporter: { companyName: string; rating: string; completedTrips: number; verificationStatus: string };
  history: { id: string; party: string; action: string; amount: string | null; createdAt: string }[];
  booking?: { id: string; bookingCode: string };
};

/** One transporter's offer, with the company's decisions: accept (final), counter, reject. */
export function CompanyOfferCard({ o, onChanged, showBooking }: { o: CompanyOffer; onChanged: () => void; showBooking?: boolean }) {
  const [counter, setCounter] = useState(false);
  const yourTurn = o.status === 'PENDING' && new Date(o.expiresAt).getTime() > Date.now();
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontWeight: '700', color: colors.ink, flex: 1 }}>{o.transporter.companyName}{o.isDemo ? ' (demo)' : ''}</Text>
        <Text style={{ fontWeight: '800', fontSize: 18, color: colors.brand700 }}>{inr(o.currentAmount)}</Text>
      </View>
      <Text style={{ color: colors.muted }}>{showBooking && o.booking ? `${o.booking.bookingCode} · ` : ''}★ {Number(o.transporter.rating).toFixed(1)} · {o.transporter.completedTrips} trips · {o.tankersAvailable} tanker(s) · round {o.round}</Text>
      <Pill label={o.status === 'PENDING' ? 'Your decision' : o.status === 'COUNTERED' ? 'Waiting for transporter' : humanize(o.status)} tone={toneFor(o.status)} />
      {o.history.slice(-3).map((h) => <Text key={h.id} style={{ color: colors.muted, fontSize: 12 }}>{humanize(h.party)}: {humanize(h.action)}{h.amount ? ` ${inr(h.amount)}` : ''} · {dateTime(h.createdAt)}</Text>)}
      {yourTurn ? (
        <View style={{ gap: 8, marginTop: 6 }}>
          <ActionButton title={`Accept ${inr(o.currentAmount)}`} action={() => api.post(`/offers/${o.id}/accept`)} success="Booking confirmed with this transporter" onDone={onChanged} confirm={`Confirm ${o.transporter.companyName} at ${inr(o.currentAmount)}? This locks the price.`} />
          <Button title="Counter-offer" variant="secondary" onPress={() => setCounter(true)} />
          <ActionButton title="Reject" variant="danger" action={() => api.post(`/offers/${o.id}/reject`, {})} success="Offer rejected" onDone={onChanged} confirm="Reject this offer?" />
          <Text style={{ color: colors.muted, fontSize: 12 }}>Valid until {dateTime(o.expiresAt)}</Text>
        </View>
      ) : null}
      <PromptModal visible={counter} title="Counter-offer" label="Your price (₹)" keyboard="numeric" submit="Send" hint={`Must be below ${inr(o.currentAmount)}`} onClose={() => setCounter(false)} onSubmit={async (v) => { await api.post(`/offers/${o.id}/counter`, { amount: Number(v) }); onChanged(); }} />
    </Card>
  );
}
