import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ENDPOINTS } from '@/services/api';
import { CompanyOfferCard, type CompanyOffer } from '@/features/company/components/CompanyOfferCard';
import { Button, Figure, LedgerRow, ManifestTable, Perforation, Pill, RouteRail, SectionHeader, T, Waybill } from '@/components/ui';
import { openMaps } from '@/utils/linking';
import { Page } from '@/components/layout';
import { PromptModal, QueryState } from '@/components/common';
import { toneFor } from '@/utils/status';
import { day, duration, humanize, inr } from '@/utils/format';
import { useQuery } from '@/hooks';
import { companyService } from '../services/companyService';
import { ROUTES } from '@/navigation/routes';

type Loc = { address: string; city: string | null; latitude: string; longitude: string };
type B = {
  id: string; bookingCode: string; status: string; customerOffer: string; suggestedFreight: string; acceptedFreight: string | null; distanceKm: string; durationMinutes: number | null;
  loadingDate: string; loadingTime: string; expectedDeliveryDate: string; loadingContactName: string; loadingContactPhone: string; deliveryContactName: string; deliveryContactPhone: string;
  canCancel: boolean; tankersAllocated: number; pickup: Loc | null; delivery: Loc | null; product: { name: string };
  requirement: { tankerCapacityKl: string; numberOfTankers: number; quantityKl: string } | null; trips?: { id: string; tripCode: string; status: string }[];
};

/** Offers still in play (the company can still act or is waiting), lowest price first; closed ones after. */
function rankOffers(offers: CompanyOffer[]) {
  const live = (o: CompanyOffer) => o.status === 'PENDING' || o.status === 'COUNTERED';
  return [...offers].sort((a, b) => Number(live(b)) - Number(live(a)) || Number(a.currentAmount) - Number(b.currentAmount));
}

/**
 * A booking as a waybill: the route and the money on top, the load as a manifest table, then the quotes
 * compared side by side with the cheapest live one marked.
 */
export default function BookingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const b = useQuery<{ booking: B }>(ENDPOINTS.company.booking(id));
  const o = useQuery<{ offers: CompanyOffer[] }>(ENDPOINTS.company.bookingOffers(id), { pollMs: 30_000 });
  const [cancel, setCancel] = useState(false);
  const x = b.data?.booking;
  const reload = () => { void b.reload(); void o.reload(); };
  const ranked = rankOffers(o.data?.offers ?? []);
  const bestId = ranked.length > 1 && (ranked[0].status === 'PENDING' || ranked[0].status === 'COUNTERED') ? ranked[0].id : null;
  const req = x?.requirement;

  return (
    <Page
      eyebrow={x ? `Booking · ${x.bookingCode}` : 'Booking'}
      title={x ? x.product.name : 'Booking'}
      subtitle={req ? `${req.quantityKl} KL · ${req.numberOfTankers} × ${req.tankerCapacityKl} KL ${req.numberOfTankers === 1 ? 'tanker' : 'tankers'}` : undefined}
      refreshing={b.refreshing}
      onRefresh={reload}
    >
      <Stack.Screen options={{ title: '' }} />
      <QueryState loading={b.loading} error={b.error} onRetry={b.reload} skeleton="detail" />
      {x ? (
        <>
          <Waybill style={{ gap: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <T v="code" c="muted">{x.bookingCode}</T>
              <Pill label={humanize(x.status)} tone={toneFor(x.status)} live={x.status === 'IN_TRANSIT'} />
            </View>
            <RouteRail from={x.pickup?.city} to={x.delivery?.city} fromDetail={x.pickup?.address} toDetail={x.delivery?.address} distanceKm={x.distanceKm} duration={x.durationMinutes ? duration(x.durationMinutes) : null} />
            <Perforation />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <Figure label={x.acceptedFreight ? 'Agreed freight' : 'Your offer'} value={inr(x.acceptedFreight ?? x.customerOffer)} />
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <T v="eyebrow" c="faint">Indicative</T>
                <T v="figure" c="muted">{inr(x.suggestedFreight)}</T>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {x.pickup ? <Button title="Pickup" icon="navigate-outline" variant="secondary" style={{ flex: 1 }} onPress={() => openMaps(Number(x.pickup!.latitude), Number(x.pickup!.longitude))} /> : null}
              {x.delivery ? <Button title="Delivery" icon="flag-outline" variant="secondary" style={{ flex: 1 }} onPress={() => openMaps(Number(x.delivery!.latitude), Number(x.delivery!.longitude))} /> : null}
            </View>
          </Waybill>

          <ManifestTable
            title="Load"
            style={{ marginTop: 8 }}
            items={[
              { label: 'Product', value: x.product.name, strong: true },
              req && { label: 'Quantity', value: `${req.quantityKl} KL`, mono: true },
              req && { label: 'Tankers', value: `${x.tankersAllocated} / ${req.numberOfTankers} allocated`, mono: true },
              { label: 'Loading', value: `${day(x.loadingDate)} · ${x.loadingTime}`, mono: true },
              { label: 'Deliver by', value: day(x.expectedDeliveryDate), mono: true },
              Boolean(x.loadingContactName) && { label: 'At pickup', value: `${x.loadingContactName} · ${x.loadingContactPhone}` },
              Boolean(x.deliveryContactName) && { label: 'At delivery', value: `${x.deliveryContactName} · ${x.deliveryContactPhone}` },
            ]}
          />

          {x.trips?.length ? (
            <View>
              <SectionHeader title="Trips" count={x.trips.length} />
              {x.trips.map((t, i, all) => (
                <LedgerRow key={t.id} code={t.tripCode} title={`Trip ${i + 1} of ${all.length}`} status={<Pill label={humanize(t.status)} tone={toneFor(t.status)} live={t.status === 'IN_TRANSIT'} />} onPress={() => router.push(ROUTES.company.trip(t.id))} last={i === all.length - 1} />
              ))}
            </View>
          ) : null}

          <SectionHeader title="Quotes" count={o.data?.offers.length} rule={false} />
          <QueryState loading={o.loading} error={o.error} skeleton="rows" skeletonCount={2} empty={o.data?.offers.length === 0} emptyText="No quotes yet" emptyIcon="hourglass-outline" />
          {o.data?.offers.length === 0 ? <T v="label" c="muted" align="center" style={{ marginTop: -30 }}>Verified transporters can see this booking now.</T> : null}
          <View style={{ gap: 12 }}>
            {ranked.map((offer) => <CompanyOfferCard key={offer.id} o={offer} onChanged={reload} best={offer.id === bestId} yourOffer={x.customerOffer} />)}
          </View>

          {x.canCancel ? <Button title="Cancel this booking" variant="ghost" icon="close" onPress={() => setCancel(true)} style={{ marginTop: 12 }} /> : null}
          <PromptModal visible={cancel} title="Cancel booking" label="Reason" submit="Cancel booking" onClose={() => setCancel(false)} onSubmit={async (reason) => { await companyService.cancelBooking(id, reason); reload(); }} />
        </>
      ) : null}
    </Page>
  );
}
