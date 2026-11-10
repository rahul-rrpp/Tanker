import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { ENDPOINTS } from '@/services/api';
import { CompanyOfferCard, type CompanyOffer } from '@/features/company/components/CompanyOfferCard';
import { Card, Pill, Row, SectionTitle, Button } from '@/components/ui';
import { openMaps } from '@/utils/linking';
import { Page } from '@/components/layout';
import { PromptModal, QueryState } from '@/components/common';
import { toneFor } from '@/utils/status';
import { day, humanize, inr, km } from '@/utils/format';
import { useQuery } from '@/hooks';
import { companyService } from '../services/companyService';
import { ROUTES } from '@/navigation/routes';

type Loc = { address: string; city: string | null; latitude: string; longitude: string };
type B = { id: string; bookingCode: string; status: string; customerOffer: string; suggestedFreight: string; acceptedFreight: string | null; distanceKm: string; loadingDate: string; loadingTime: string; expectedDeliveryDate: string; canCancel: boolean; tankersAllocated: number; pickup: Loc | null; delivery: Loc | null; product: { name: string }; requirement: { tankerCapacityKl: string; numberOfTankers: number; quantityKl: string } | null; trips?: { id: string; tripCode: string; status: string }[] };

export default function BookingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const b = useQuery<{ booking: B }>(ENDPOINTS.company.booking(id));
  const o = useQuery<{ offers: CompanyOffer[] }>(ENDPOINTS.company.bookingOffers(id), { pollMs: 30_000 });
  const [cancel, setCancel] = useState(false);
  const x = b.data?.booking;
  const reload = () => { void b.reload(); void o.reload(); };
  return (
    <Page title={x ? `${x.pickup?.city} → ${x.delivery?.city}` : 'Booking'} subtitle={x?.bookingCode} refreshing={b.refreshing} onRefresh={reload}>
      <Stack.Screen options={{ title: x?.bookingCode ?? 'Booking' }} />
      <QueryState loading={b.loading} error={b.error} onRetry={b.reload} />
      {x ? (
        <>
          <Pill label={humanize(x.status)} tone={toneFor(x.status)} />
          <Card>
            <Row label="Pickup" value={x.pickup?.address} />
            <Row label="Delivery" value={x.delivery?.address} />
            <Row label="Road distance" value={km(x.distanceKm)} />
            <Row label="Product" value={x.product.name} />
            <Row label="Tankers" value={`${x.tankersAllocated} of ${x.requirement?.numberOfTankers} allocated · ${x.requirement?.tankerCapacityKl} KL`} />
            <Row label="Loading" value={`${day(x.loadingDate)}, ${x.loadingTime}`} />
            <Row label="Delivery by" value={day(x.expectedDeliveryDate)} />
            <Row label="Your offer" value={inr(x.customerOffer)} />
            <Row label="Indicative freight" value={inr(x.suggestedFreight)} />
            <Row label="Agreed freight" value={inr(x.acceptedFreight)} />
          </Card>
          {x.pickup ? <Button title="Pickup in Maps" variant="secondary" onPress={() => openMaps(Number(x.pickup!.latitude), Number(x.pickup!.longitude))} /> : null}
          {x.trips?.length ? <SectionTitle>Trips</SectionTitle> : null}
          {x.trips?.map((t) => <Card key={t.id} onPress={() => router.push(ROUTES.company.trip(t.id))}><Text>{t.tripCode}</Text><Pill label={humanize(t.status)} tone={toneFor(t.status)} /></Card>)}
          <SectionTitle>Offers</SectionTitle>
          <QueryState loading={o.loading} error={o.error} empty={o.data?.offers.length === 0} emptyText="No offers yet. Transporters see your booking now." />
          {o.data?.offers.map((offer) => <CompanyOfferCard key={offer.id} o={offer} onChanged={reload} />)}
          {x.canCancel ? <Button title="Cancel booking" variant="danger" onPress={() => setCancel(true)} /> : null}
          <PromptModal visible={cancel} title="Cancel booking" label="Reason" submit="Cancel booking" onClose={() => setCancel(false)} onSubmit={async (reason) => { await companyService.cancelBooking(id, reason); reload(); }} />
        </>
      ) : null}
    </Page>
  );
}
