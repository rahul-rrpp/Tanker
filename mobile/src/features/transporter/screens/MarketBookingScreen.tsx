import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { ENDPOINTS } from '@/services/api';
import { ActionButton, PromptModal, QueryState } from '@/components/common';
import { Button, Card, Field, InfoCard, SummaryCard } from '@/components/ui';
import { Page } from '@/components/layout';
import { dateTime, day, duration, inr, km } from '@/utils/format';
import { colors } from '@/theme';
import { useQuery } from '@/hooks';
import type { MarketCard } from '@/features/transporter/types';
import { transporterService } from '../services/transporterService';
import { ROUTES } from '@/navigation/routes';

type Detail = { booking: MarketCard & { company: string; pickupAddress: string; deliveryAddress: string; durationMinutes: number; quantityKl: number; expectedDeliveryDate: string; suggestedFreight: number; offerId: string | null; specialRequirements: string | null }; availableTankers: { id: string; registrationNumber: string; capacityKl: number }[] };

export default function MarketBookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useQuery<Detail>(ENDPOINTS.transporter.marketBooking(id));
  const [tankers, setTankers] = useState('1');
  const [counter, setCounter] = useState(false);
  const b = q.data?.booking;
  const max = b ? Math.min(b.remainingTankers, q.data!.availableTankers.length) : 1;
  const n = Math.max(1, Math.min(max, Number(tankers) || 1));
  const share = b ? Math.round((b.customerOffer * n) / b.numberOfTankers) : 0;
  const submit = async (body: object) => {
    const r = await transporterService.submitOffer(id, { tankers: n, ...body });
    router.replace(ROUTES.transporter.offer(r.data.data.offerId));
  };
  return (
    <Page title="Booking request" subtitle={b ? b.company : undefined}>
      <Stack.Screen options={{ title: b?.bookingCode ?? 'Booking' }} />
      <QueryState loading={q.loading} error={q.error} onRetry={q.reload} skeleton="detail" />
      {b ? (
        <>
          <SummaryCard
            code={b.bookingCode}
            from={b.pickupCity}
            to={b.deliveryCity}
            fromDetail={b.pickupAddress}
            toDetail={b.deliveryAddress}
            amountLabel="Customer offered freight"
            amount={inr(b.customerOffer)}
            amountNote={`Indicative platform freight ${inr(b.suggestedFreight)}`}
          />
          <InfoCard
            title="Load"
            items={[
              { icon: 'resize-outline', label: 'Road distance', value: `${km(b.distanceKm)} · ${duration(b.durationMinutes)}` },
              { icon: 'flask-outline', label: 'Product', value: b.product },
              { icon: 'water-outline', label: 'Quantity', value: `${b.quantityKl} KL in ${b.tankerCapacityKl} KL tankers` },
              { icon: 'bus-outline', label: 'Tankers needed', value: `${b.remainingTankers} of ${b.numberOfTankers}` },
              { icon: 'calendar-outline', label: 'Loading', value: `${day(b.loadingDate)}, ${b.loadingTime}` },
              { icon: 'flag-outline', label: 'Delivery by', value: day(b.expectedDeliveryDate) },
              { icon: 'hourglass-outline', label: 'Offers close', value: dateTime(b.offerExpiresAt) },
              b.specialRequirements ? { icon: 'information-circle-outline', label: 'Requirements', value: b.specialRequirements } : null,
            ]}
          />
          {b.offerId ? (
            <Button title="View my negotiation" icon="chatbubbles-outline" onPress={() => router.push(ROUTES.transporter.offer(b.offerId!))} />
          ) : (
            <Card style={{ gap: 10 }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: colors.ink }}>Make your offer</Text>
              <Field label={`Tankers you offer (up to ${max})`} value={tankers} onChangeText={setTankers} keyboardType="number-pad" />
              <ActionButton title={`Accept ${inr(share)}`} icon="checkmark-circle-outline" action={() => submit({ mode: 'ACCEPT' })} success="Offer submitted at the customer's price. The company confirms next." confirm={`Offer ${n} tanker(s) at ${inr(share)}?`} />
              <Button title="Make counter-offer" icon="swap-horizontal-outline" variant="secondary" onPress={() => setCounter(true)} />
              <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>Accepting submits your offer. The company still confirms which transporter it books.</Text>
            </Card>
          )}
          <PromptModal visible={counter} title="Counter-offer" label={`Your total price for ${n} tanker(s) (₹)`} keyboard="numeric" submit="Send" hint={`Customer's price for these: ${inr(share)}`} onClose={() => setCounter(false)} onSubmit={(v) => submit({ mode: 'COUNTER', amount: Number(v) })} />
        </>
      ) : null}
    </Page>
  );
}
