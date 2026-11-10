import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { parseApiError, ENDPOINTS } from '@/services/api';
import { useAuth } from '@/features/auth/context/AuthContext';
import { Card, Chips, Row, Banner, Button, Field } from '@/components/ui';
import { Page } from '@/components/layout';
import { PickerModal } from '@/components/common';
import { pageStyles as s, colors } from '@/theme';
import { addDays, inr, km, todayIst } from '@/utils/format';
import { useQuery } from '@/hooks';
import { companyService } from '../services/companyService';
import { ROUTES } from '@/navigation/routes';

type Place = { placeId: string | null; address: string; latitude: number; longitude: number; city: string | null; state: string | null; pincode: string | null };
type Suggestion = { placeId: string; primaryText: string; secondaryText: string; location?: Place };
type Catalog = { products: { id: string; name: string }[] };
type Quote = { selectedRoute: { distanceKm: number; durationMinutes: number }; estimate: { suggestedFreight: string | number; minOffer?: number; maxOffer?: number } };

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
      {value ? <Card><Text style={s.rowLabel}>{label}</Text><Text style={{ color: colors.ink, fontWeight: '600' }}>{value.address}</Text></Card> : null}
      <Field label={value ? `Change ${label.toLowerCase()}` : label} value={q} onChangeText={setQ} placeholder="Search area, factory or depot" />
      {items.map((i) => (
        <Pressable key={i.placeId} onPress={() => void choose(i)} style={s.pickRow} accessibilityRole="button">
          <Text style={{ color: colors.ink, fontWeight: '600' }}>{i.primaryText}</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>{i.secondaryText}</Text>
        </Pressable>
      ))}
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

  return (
    <Page title="Book a tanker">
      <Stack.Screen options={{ title: 'New booking' }} />
      {error ? <Banner>{error}</Banner> : null}
      <PlaceSearch label="Pickup" value={pickup} onPick={setPickup} />
      <PlaceSearch label="Delivery" value={delivery} onPick={setDelivery} />
      <Button title={product ? `Product: ${product.label}` : 'Choose product'} variant="secondary" onPress={() => setPickProduct(true)} />
      <Text style={s.rowLabel}>Tanker capacity (KL)</Text>
      <Chips value={cap} options={CAPS.map((c) => ({ value: String(c), label: `${c} KL` }))} onChange={setCap} />
      <Field label="Number of tankers" value={f.tankers} onChangeText={set('tankers')} keyboardType="number-pad" />
      <Field label="Quantity (KL)" value={f.quantity} onChangeText={set('quantity')} keyboardType="decimal-pad" />
      <Field label="Loading date (YYYY-MM-DD)" value={f.loadingDate} onChangeText={set('loadingDate')} />
      <Field label="Loading time (HH:mm)" value={f.loadingTime} onChangeText={set('loadingTime')} />
      <Field label="Expected delivery (YYYY-MM-DD)" value={f.deliveryDate} onChangeText={set('deliveryDate')} />
      <Field label="Loading contact name" value={f.loadName} onChangeText={set('loadName')} />
      <Field label="Loading contact mobile" value={f.loadPhone} onChangeText={set('loadPhone')} keyboardType="phone-pad" maxLength={10} />
      <Field label="Delivery contact name" value={f.dropName} onChangeText={set('dropName')} />
      <Field label="Delivery contact mobile" value={f.dropPhone} onChangeText={set('dropPhone')} keyboardType="phone-pad" maxLength={10} />
      {quote ? (
        <Card>
          <Row label="Road distance" value={km(quote.selectedRoute.distanceKm)} />
          <Row label="Indicative freight" value={inr(quote.estimate.suggestedFreight)} />
        </Card>
      ) : null}
      <Field label="Your freight offer (₹, total)" value={f.offer} onChangeText={set('offer')} keyboardType="number-pad" />
      <Button title="Submit booking" loading={busy} disabled={!ready || busy} onPress={() => void submit()} />
      <PickerModal visible={pickProduct} title="Product" items={catalog.data?.products.map((p) => ({ id: p.id, label: p.name })) ?? []} onClose={() => setPickProduct(false)} onPick={setProduct} />
    </Page>
  );
}
