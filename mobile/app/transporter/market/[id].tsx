import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { api } from '@/api/client';
import { ActionButton, Card, Page, PromptModal, QueryState, Row } from '@/components/kit';
import { Button, Field } from '@/components/ui';
import { dateTime, day, duration, inr, km } from '@/lib/format';
import { colors } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';
import type { MarketCard } from '../(tabs)/market';

type Detail = { booking: MarketCard & { company: string; pickupAddress: string; deliveryAddress: string; durationMinutes: number; quantityKl: number; expectedDeliveryDate: string; suggestedFreight: number; offerId: string | null; specialRequirements: string | null }; availableTankers: { id: string; registrationNumber: string; capacityKl: number }[] };

export default function MarketBooking() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useQuery<Detail>(`/marketplace/bookings/${id}`);
  const [tankers, setTankers] = useState('1');
  const [counter, setCounter] = useState(false);
  const b = q.data?.booking;
  const max = b ? Math.min(b.remainingTankers, q.data!.availableTankers.length) : 1;
  const n = Math.max(1, Math.min(max, Number(tankers) || 1));
  const share = b ? Math.round((b.customerOffer * n) / b.numberOfTankers) : 0;
  const submit = async (body: object) => {
    const r = await api.post(`/bookings/${id}/offers`, { tankers: n, ...body });
    router.replace(`/transporter/offer/${r.data.data.offerId}`);
  };
  return (
    <Page title={b ? `${b.pickupCity} → ${b.deliveryCity}` : 'Booking'} subtitle={b ? `${b.bookingCode} · ${b.company}` : undefined}>
      <Stack.Screen options={{ title: b?.bookingCode ?? 'Booking' }} />
      <QueryState loading={q.loading} error={q.error} onRetry={q.reload} />
      {b ? (
        <>
          <Card>
            <Text style={{ color: colors.muted }}>Customer offered freight</Text>
            <Text style={{ fontSize: 26, fontWeight: '800', color: colors.brand700 }}>{inr(b.customerOffer)}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Indicative platform freight {inr(b.suggestedFreight)}</Text>
          </Card>
          <Card>
            <Row label="Pickup" value={b.pickupAddress} />
            <Row label="Delivery" value={b.deliveryAddress} />
            <Row label="Road distance" value={`${km(b.distanceKm)} · ${duration(b.durationMinutes)}`} />
            <Row label="Product" value={b.product} />
            <Row label="Quantity" value={`${b.quantityKl} KL in ${b.tankerCapacityKl} KL tankers`} />
            <Row label="Tankers needed" value={`${b.remainingTankers} of ${b.numberOfTankers}`} />
            <Row label="Loading" value={`${day(b.loadingDate)}, ${b.loadingTime}`} />
            <Row label="Delivery by" value={day(b.expectedDeliveryDate)} />
            <Row label="Offers close" value={dateTime(b.offerExpiresAt)} />
            {b.specialRequirements ? <Row label="Requirements" value={b.specialRequirements} /> : null}
          </Card>
          {b.offerId ? (
            <Button title="View my negotiation" onPress={() => router.push(`/transporter/offer/${b.offerId}`)} />
          ) : (
            <>
              <Field label={`Tankers you offer (up to ${max})`} value={tankers} onChangeText={setTankers} keyboardType="number-pad" />
              <ActionButton title={`Accept ${inr(share)}`} action={() => submit({ mode: 'ACCEPT' })} success="Offer submitted at the customer's price. The company confirms next." confirm={`Offer ${n} tanker(s) at ${inr(share)}?`} />
              <Button title="Make counter-offer" variant="secondary" onPress={() => setCounter(true)} />
              <Text style={{ color: colors.muted, fontSize: 12 }}>Accepting submits your offer. The company still confirms which transporter it books.</Text>
            </>
          )}
          <PromptModal visible={counter} title="Counter-offer" label={`Your total price for ${n} tanker(s) (₹)`} keyboard="numeric" submit="Send" hint={`Customer's price for these: ${inr(share)}`} onClose={() => setCounter(false)} onSubmit={(v) => submit({ mode: 'COUNTER', amount: Number(v) })} />
        </>
      ) : null}
    </Page>
  );
}
