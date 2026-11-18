import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { dateTime, humanize, inr } from '@/utils/format';
import { colors, fonts } from '@/theme';
import { ActionButton, PromptModal } from '@/components/common';
import { Button, Pill, T } from '@/components/ui';
import { toneFor } from '@/utils/status';
import { offersService } from '@/services/domain/offersService';

export type CompanyOffer = {
  id: string; status: string; currentAmount: string; expiresAt: string; tankersAvailable: number; round: number; isDemo: boolean;
  transporter: { companyName: string; rating: string; completedTrips: number; verificationStatus: string };
  history: { id: string; party: string; action: string; amount: string | null; createdAt: string }[];
  booking?: { id: string; bookingCode: string };
};

/**
 * The negotiation as a price ladder: each priced step in mono, left to right, the latest in ink.
 * Company steps are marked "you" so the back-and-forth is readable at a glance.
 */
function PriceLadder({ history }: { history: CompanyOffer['history'] }) {
  const steps = history.filter((h) => h.amount !== null);
  if (steps.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', gap: 6 }}>
      {steps.map((h, i) => {
        const last = i === steps.length - 1;
        const you = h.party.toUpperCase().includes('COMPANY');
        return (
          <View key={h.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ alignItems: 'center' }}>
              <T v="code" c={last ? 'ink' : 'faint'} style={last ? { fontFamily: fonts.monoBold } : null}>{inr(h.amount)}</T>
              <T v="caption" c="faint" style={{ fontSize: 10 }}>{you ? 'you' : 'them'}</T>
            </View>
            {!last ? <Ionicons name="arrow-forward" size={12} color={colors.faint} style={{ marginBottom: 12 }} /> : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

/**
 * One transporter's quote, as a slip: who, how much (and how that compares to your price), the
 * negotiation so far, and the company's decisions. `best` marks the lowest live quote on a booking.
 */
export function CompanyOfferCard({ o, onChanged, showBooking, best, yourOffer }: { o: CompanyOffer; onChanged: () => void; showBooking?: boolean; best?: boolean; yourOffer?: number | string | null }) {
  const [counter, setCounter] = useState(false);
  const yourTurn = o.status === 'PENDING' && new Date(o.expiresAt).getTime() > Date.now();
  const mine = yourOffer !== undefined && yourOffer !== null ? Number(yourOffer) : null;
  const delta = mine ? Math.round(((Number(o.currentAmount) - mine) / mine) * 100) : null;
  const statusLabel = o.status === 'PENDING' ? 'Your decision' : o.status === 'COUNTERED' ? 'Waiting for transporter' : humanize(o.status);
  return (
    <View style={[styles.slip, best && { borderLeftWidth: 3, borderLeftColor: colors.accent }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <T v="code" c="faint" numberOfLines={1} style={{ flexShrink: 1 }}>
          {[showBooking && o.booking ? o.booking.bookingCode : null, `ROUND ${o.round}`].filter(Boolean).join(' · ')}
        </T>
        {best ? <T v="eyebrow" c="accent">Lowest</T> : <Pill label={statusLabel} tone={toneFor(o.status)} />}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <T v="subheading" numberOfLines={1}>{o.transporter.companyName}{o.isDemo ? ' · demo' : ''}</T>
          <T v="caption" c="muted">★ {Number(o.transporter.rating).toFixed(1)} · {o.transporter.completedTrips} trips · {o.tankersAvailable} {o.tankersAvailable === 1 ? 'tanker' : 'tankers'}</T>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <T v="bigFigure" style={{ fontSize: 26, lineHeight: 30 }}>{inr(o.currentAmount)}</T>
          {delta !== null ? (
            <T v="code" c={delta <= 0 ? 'success' : 'warning'}>{delta === 0 ? 'matches your price' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)}% vs yours`}</T>
          ) : null}
        </View>
      </View>

      {best ? <Pill label={statusLabel} tone={toneFor(o.status)} /> : null}
      <PriceLadder history={o.history} />

      {yourTurn ? (
        <View style={{ gap: 8, paddingTop: 4 }}>
          <ActionButton title={`Accept ${inr(o.currentAmount)}`} icon="checkmark" action={() => offersService.accept(o.id)} success="Booking confirmed with this transporter" onDone={onChanged} confirm={`Confirm ${o.transporter.companyName} at ${inr(o.currentAmount)}? This locks the price.`} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button title="Counter" variant="secondary" onPress={() => setCounter(true)} /></View>
            <View style={{ flex: 1 }}><ActionButton title="Reject" variant="ghost" action={() => offersService.reject(o.id, {})} success="Offer rejected" onDone={onChanged} confirm="Reject this offer?" /></View>
          </View>
          <T v="caption" c="faint" align="center">Valid until {dateTime(o.expiresAt)}</T>
        </View>
      ) : null}
      <PromptModal visible={counter} title="Counter-offer" label="Your price (₹)" keyboard="numeric" submit="Send counter" hint={`Must be below ${inr(o.currentAmount)}`} onClose={() => setCounter(false)} onSubmit={async (v) => { await offersService.counter(o.id, Number(v)); onChanged(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  slip: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: 16, gap: 12 },
});
