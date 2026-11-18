import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { parseApiError, ENDPOINTS } from '@/services/api';
import { useAuth } from '@/features/auth/context/AuthContext';
import { Appear, Banner, BottomBar, Button, Chips, Field, RouteRail, T, Waybill } from '@/components/ui';
import { Page } from '@/components/layout';
import { PickerModal } from '@/components/common';
import { colors } from '@/theme';
import { addDays, day, duration, inr, km, todayIst } from '@/utils/format';
import { useBackHandler, useQuery } from '@/hooks';
import { companyService } from '../services/companyService';
import { ROUTES } from '@/navigation/routes';

type Place = { placeId: string | null; address: string; latitude: number; longitude: number; city: string | null; state: string | null; pincode: string | null };
type Suggestion = { placeId: string; primaryText: string; secondaryText: string; location?: Place };
type Catalog = { products: { id: string; name: string }[] };
type Quote = { selectedRoute: { distanceKm: number; durationMinutes: number }; estimate: { suggestedFreight: string | number; minOffer?: number; maxOffer?: number } };

/** One question per step. */
const STEPS = [
  { key: 'route', title: 'Where from, where to?', hint: 'Search a factory, depot or area. Distance is measured by road.' },
  { key: 'load', title: 'What are you moving?', hint: 'Product, tanker size and how much.' },
  { key: 'schedule', title: 'When should it load?', hint: 'Transporters plan around these dates.' },
  { key: 'contacts', title: 'Who meets the tanker?', hint: 'The driver calls these numbers at each end.' },
  { key: 'price', title: 'Name your price.', hint: 'Transporters accept it or send a counter-offer.' },
] as const;

const Pair = ({ children }: { children: ReactNode }) => <View style={{ flexDirection: 'row', gap: 12 }}>{children}</View>;
const Half = ({ children }: { children: ReactNode }) => <View style={{ flex: 1 }}>{children}</View>;

/** Address search through the backend (Google Places, or OpenStreetMap in development). */
function PlaceSearch({ label, value, onPick }: { label: string; value: Place | null; onPick: (p: Place) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Suggestion[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 3) return setItems([]);
    timer.current = setTimeout(() => {
      companyService.searchPlaces(q.trim()).then((r) => setItems(r.data.data.suggestions)).catch(() => setItems([]));
    }, 350);
  }, [q]);
  const choose = async (sgn: Suggestion) => {
    const place = sgn.location ?? (await companyService.placeDetails(sgn.placeId)).data.data.place;
    onPick(place);
    setQ('');
    setItems([]);
  };
  return (
    <View>
      <Field label={value ? `Change ${label.toLowerCase()}` : label} value={q} onChangeText={setQ} placeholder="Search area, factory or depot" />
      {items.length ? (
        <View style={styles.suggestions}>
          {items.map((i, idx) => (
            <Pressable key={i.placeId} onPress={() => void choose(i)} accessibilityRole="button" style={({ pressed }) => [styles.suggestion, idx > 0 && styles.suggestionRule, pressed && { backgroundColor: colors.neutralBg }]}>
              <Ionicons name="location-outline" size={18} color={colors.ink} />
              <View style={{ flex: 1 }}>
                <T v="bodyStrong" numberOfLines={1}>{i.primaryText}</T>
                <T v="caption" c="muted" numberOfLines={1}>{i.secondaryText}</T>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const CAPS = [10, 12, 16, 20, 24, 30];

export default function NewBookingScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const catalog = useQuery<Catalog>(ENDPOINTS.catalog);
  const [pickup, setPickup] = useState<Place | null>(null);
  const [delivery, setDelivery] = useState<Place | null>(null);
  const [product, setProduct] = useState<{ id: string; label: string } | null>(null);
  const [pickProduct, setPickProduct] = useState(false);
  const [cap, setCap] = useState('20');
  const [f, setF] = useState({ tankers: '1', quantity: '20', loadingDate: addDays(todayIst(), 1), loadingTime: '09:00', deliveryDate: addDays(todayIst(), 2), loadName: user?.fullName ?? '', loadPhone: user?.phone ?? '', dropName: '', dropPhone: '', offer: '' });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  // Road distance and indicative freight are always computed by the server.
  useEffect(() => {
    setQuote(null);
    if (!pickup || !delivery || !product) return;
    companyService.quote({ pickup: { latitude: pickup.latitude, longitude: pickup.longitude, state: pickup.state ?? undefined }, delivery: { latitude: delivery.latitude, longitude: delivery.longitude, state: delivery.state ?? undefined }, productId: product.id, tankerCapacityKl: Number(cap), numberOfTankers: Number(f.tankers) || 1 })
      .then((r) => { setQuote(r.data.data); setError(null); })
      .catch((e) => setError(parseApiError(e).message));
  }, [pickup, delivery, product, cap, f.tankers]);

  const loc = (p: Place) => ({ address: p.address, latitude: p.latitude, longitude: p.longitude, ...(p.placeId ? { placeId: p.placeId } : {}), ...(p.city ? { city: p.city } : {}), ...(p.state ? { state: p.state } : {}), ...(p.pincode ? { pincode: p.pincode } : {}) });
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await companyService.createBooking({
        pickup: loc(pickup!), delivery: loc(delivery!), routeIndex: 0, productId: product!.id, tankerCapacityKl: Number(cap), quantityKl: Number(f.quantity), numberOfTankers: Number(f.tankers),
        loadingDate: f.loadingDate, loadingTime: f.loadingTime, loadingContactName: f.loadName.trim(), loadingContactPhone: f.loadPhone.trim(), expectedDeliveryDate: f.deliveryDate, deliveryContactName: f.dropName.trim(), deliveryContactPhone: f.dropPhone.trim(), customerOffer: Number(f.offer),
      });
      router.replace(ROUTES.company.booking(r.data.data.booking.id));
    } catch (e) {
      const p = parseApiError(e);
      setError(p.fields.length ? `${p.message}: ${p.fields.map((x) => x.message).join('; ')}` : p.message);
    } finally {
      setBusy(false);
    }
  };
  const ready = pickup && delivery && product && quote && Number(f.offer) > 0 && f.dropName.trim() && /^\d{10}$/.test(f.dropPhone.trim()) && /^\d{10}$/.test(f.loadPhone.trim());

  // ---- Step flow (presentation only; the form state above is unchanged) ----------------------------
  const [step, setStep] = useState(0);
  const phoneOk = (v: string) => /^\d{10}$/.test(v.trim());
  const dateOk = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
  const canContinue = [
    Boolean(pickup && delivery),
    Boolean(product && Number(f.tankers) > 0 && Number(f.quantity) > 0),
    dateOk(f.loadingDate) && /^\d{2}:\d{2}$/.test(f.loadingTime.trim()) && dateOk(f.deliveryDate),
    Boolean(f.loadName.trim() && phoneOk(f.loadPhone) && f.dropName.trim() && phoneOk(f.dropPhone)),
    Boolean(ready),
  ][step];
  const last = step === STEPS.length - 1;
  // Android back walks back through the steps before leaving the screen.
  useBackHandler(useCallback(() => {
    if (step > 0 && !busy) { setStep((s) => s - 1); return true; }
    return false;
  }, [step, busy]));
  const S = STEPS[step];

  return (
    <Page
      eyebrow={`Book a tanker · step ${step + 1} of ${STEPS.length}`}
      title={S.title}
      subtitle={S.hint}
      footer={
        <BottomBar>
          {quote ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T v="code" c="muted">{km(quote.selectedRoute.distanceKm)} · {duration(quote.selectedRoute.durationMinutes)}</T>
              <T v="code">indicative {inr(quote.estimate.suggestedFreight)}</T>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {step > 0 ? <Button title="Back" variant="secondary" onPress={() => setStep(step - 1)} disabled={busy} style={{ flex: 1 }} /> : null}
            {last ? (
              <Button title="Send to transporters" variant="accent" loading={busy} disabled={!ready || busy} onPress={() => void submit()} style={{ flex: 2 }} />
            ) : (
              <Button title="Continue" trailingIcon="arrow-forward" disabled={!canContinue} onPress={() => setStep(step + 1)} style={{ flex: 2 }} />
            )}
          </View>
        </BottomBar>
      }
    >
      <Stack.Screen options={{ title: '' }} />
      {/* Progress: five segments, done ones in ink. */}
      <View style={{ flexDirection: 'row', gap: 4, marginTop: 2 }} accessibilityLabel={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((x, i) => <View key={x.key} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= step ? colors.ink : colors.line }} />)}
      </View>
      {error ? <Banner>{error}</Banner> : null}

      <Appear key={S.key}>
        {step === 0 ? (
          <View style={{ gap: 16 }}>
            {pickup || delivery ? (
              <Waybill>
                <RouteRail from={pickup?.city ?? (pickup ? 'Pickup' : 'Choose pickup')} to={delivery?.city ?? (delivery ? 'Delivery' : 'Choose delivery')} fromDetail={pickup?.address} toDetail={delivery?.address} distanceKm={quote?.selectedRoute.distanceKm} />
              </Waybill>
            ) : null}
            <View>
              <PlaceSearch label="Pickup" value={pickup} onPick={setPickup} />
              <PlaceSearch label="Delivery" value={delivery} onPick={setDelivery} />
            </View>
          </View>
        ) : null}

        {step === 1 ? (
          <View style={{ gap: 18 }}>
            <Pressable onPress={() => setPickProduct(true)} accessibilityRole="button" accessibilityLabel={product ? `Product: ${product.label}. Change` : 'Choose product'} style={[styles.select, product && { borderColor: colors.ink }]}>
              <View style={{ flex: 1 }}>
                <T v="eyebrow" c="muted">Product</T>
                <T v="subheading" c={product ? 'ink' : 'faint'} style={{ marginTop: 2 }}>{product ? product.label : 'Choose product'}</T>
              </View>
              <Ionicons name="chevron-down" size={18} color={colors.ink} />
            </Pressable>
            <View>
              <T v="label" style={{ marginBottom: 2 }}>Tanker capacity</T>
              <Chips value={cap} bleed={false} options={CAPS.map((c) => ({ value: String(c), label: `${c} KL` }))} onChange={setCap} />
            </View>
            <Pair>
              <Half><Field label="Tankers" value={f.tankers} onChangeText={set('tankers')} keyboardType="number-pad" /></Half>
              <Half><Field label="Quantity (KL)" value={f.quantity} onChangeText={set('quantity')} keyboardType="decimal-pad" /></Half>
            </Pair>
          </View>
        ) : null}

        {step === 2 ? (
          <View>
            <Pair>
              <Half><Field label="Loading date" value={f.loadingDate} onChangeText={set('loadingDate')} hint="YYYY-MM-DD" /></Half>
              <Half><Field label="Loading time" value={f.loadingTime} onChangeText={set('loadingTime')} hint="24 h, HH:mm" /></Half>
            </Pair>
            <Field label="Deliver by" value={f.deliveryDate} onChangeText={set('deliveryDate')} hint="YYYY-MM-DD" />
          </View>
        ) : null}

        {step === 3 ? (
          <View>
            <T v="eyebrow" c="muted" style={{ marginBottom: 10 }}>At pickup</T>
            <Field label="Name" value={f.loadName} onChangeText={set('loadName')} />
            <Field label="Mobile" value={f.loadPhone} onChangeText={set('loadPhone')} keyboardType="phone-pad" maxLength={10} prefix="+91" />
            <T v="eyebrow" c="muted" style={{ marginTop: 8, marginBottom: 10 }}>At delivery</T>
            <Field label="Name" value={f.dropName} onChangeText={set('dropName')} />
            <Field label="Mobile" value={f.dropPhone} onChangeText={set('dropPhone')} keyboardType="phone-pad" maxLength={10} prefix="+91" />
          </View>
        ) : null}

        {step === 4 ? (
          <View style={{ gap: 18 }}>
            <Waybill style={{ gap: 14 }}>
              <RouteRail from={pickup?.city} to={delivery?.city} distanceKm={quote?.selectedRoute.distanceKm} duration={quote ? duration(quote.selectedRoute.durationMinutes) : null} />
              <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: 12, gap: 4 }}>
                <T v="bodyStrong">{product?.label ?? '—'}</T>
                <T v="code" c="muted">{f.tankers} × {cap} KL · {f.quantity} KL · loads {day(f.loadingDate)} {f.loadingTime}</T>
              </View>
            </Waybill>
            {quote ? (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View><T v="eyebrow" c="muted">Indicative freight</T><T v="heading" style={{ marginTop: 2 }}>{inr(quote.estimate.suggestedFreight)}</T></View>
                {quote.estimate.minOffer && quote.estimate.maxOffer ? (
                  <View style={{ alignItems: 'flex-end' }}><T v="eyebrow" c="muted">Accepted range</T><T v="code" style={{ marginTop: 6 }}>{inr(quote.estimate.minOffer)} – {inr(quote.estimate.maxOffer)}</T></View>
                ) : null}
              </View>
            ) : (
              <T v="label" c="muted">Working out the road distance and an indicative price…</T>
            )}
            <Field label="Your offer for the whole booking" value={f.offer} onChangeText={set('offer')} keyboardType="number-pad" prefix="₹" style={{ fontSize: 22 }} />
          </View>
        ) : null}
      </Appear>

      <PickerModal visible={pickProduct} title="Product" items={catalog.data?.products.map((p) => ({ id: p.id, label: p.name })) ?? []} onClose={() => setPickProduct(false)} onPick={setProduct} />
    </Page>
  );
}

const styles = StyleSheet.create({
  suggestions: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, borderRadius: 10, marginTop: -8, marginBottom: 14, overflow: 'hidden', backgroundColor: colors.surface },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  suggestionRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  select: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
});
