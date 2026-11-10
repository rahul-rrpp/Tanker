'use client';

import clsx from 'clsx';
import { ArrowRight, BookmarkPlus, Check, Clock, Info, Loader2, Route, Search, Truck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LocationSearch } from '@/components/maps/LocationSearch';
import { MapView, type LL } from '@/components/maps/MapView';
import { SaveLocationDialog } from '@/components/maps/SaveLocationDialog';
import { Modal, PageHeader, TextArea, useToast } from '@/components/ui/kit';
import { Alert, Button, SelectField, TextField } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';
import type { Catalog, LocationValue, Quote, RouteOption, SavedLocation } from '@/lib/company-types';
import { duration, inr, km, todayIST } from '@/lib/format';
import { COMPARTMENTS, PRODUCT_COMPATIBILITY } from '@/lib/status';
import type { AuthUser } from '@/lib/types';
import { useApi } from '@/lib/useApi';
import { phone as phoneSchema, fullName as nameSchema } from '@/lib/validation';

const STEPS = [
  { title: 'Route', sub: 'Pickup, delivery & road distance' },
  { title: 'Load & tanker', sub: 'Product and tanker requirements' },
  { title: 'Schedule', sub: 'Loading and delivery details' },
  { title: 'Freight', sub: 'Estimate and your offer' },
];

type Errors = Record<string, string>;

const addDays = (iso: string, d: number) => {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + d);
  return dt.toISOString().slice(0, 10);
};

export function BookingWizard() {
  const router = useRouter();
  const params = useSearchParams();
  const repeatId = params.get('repeat');
  const toast = useToast();
  const { data: catalog } = useApi<Catalog>('/catalog');
  const { data: savedData, mutate: reloadSaved } = useApi<{ locations: SavedLocation[] }>('/locations');
  const saved = savedData?.locations ?? [];

  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [pickup, setPickup] = useState<LocationValue | null>(null);
  const [delivery, setDelivery] = useState<LocationValue | null>(null);
  const [pickMode, setPickMode] = useState<'pickup' | 'delivery' | null>(null);
  const [routes, setRoutes] = useState<{ provider: string; providerLabel: string; routes: RouteOption[] } | null>(null);
  const [routeIndex, setRouteIndex] = useState(0);
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [saveFor, setSaveFor] = useState<'pickup' | 'delivery' | null>(null);
  type Manual = { address: string; city: string; state: string; pincode: string } | null;
  const [manual, setManual] = useState<{ pickup: Manual; delivery: Manual }>({ pickup: null, delivery: null });
  const { data: me } = useApi<{ user: AuthUser }>('/auth/me');
  const companyStatus = me?.user.company?.status;
  const canSubmit = companyStatus === 'VERIFIED';

  const [f, setF] = useState({
    productId: '',
    capacity: '20',
    customCapacity: '',
    quantityKl: '',
    numberOfTankers: '1',
    tankerTypeId: '',
    compartmentRequirement: 'ANY',
    productCompatibility: 'ANY_COMPATIBLE',
    specialRequirements: '',
    loadingDate: addDays(todayIST(), 1),
    loadingTime: '09:00',
    loadingContactName: '',
    loadingContactPhone: '',
    loadingInstructions: '',
    expectedDeliveryDate: addDays(todayIST(), 2),
    deliveryContactName: '',
    deliveryContactPhone: '',
    deliveryInstructions: '',
    customerOffer: '',
  });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [repeatOf, setRepeatOf] = useState<{ id: string; code: string; previousOffer: number } | null>(null);
  const [defaultsApplied, setDefaultsApplied] = useState(false);

  const capacityKl = f.capacity === 'OTHER' ? Number(f.customCapacity) : Number(f.capacity);
  const tankers = Number(f.numberOfTankers) || 1;

  // Defaults: saved default pickup/delivery + their site contacts.
  useEffect(() => {
    if (defaultsApplied || !savedData || repeatId) return;
    const dp = saved.find((s) => s.isDefaultPickup);
    const dd = saved.find((s) => s.isDefaultDelivery);
    if (dp) {
      setPickup({ address: dp.address, latitude: dp.latitude, longitude: dp.longitude, city: dp.city ?? undefined, state: dp.state ?? undefined, pincode: dp.pincode ?? undefined, placeId: dp.placeId ?? undefined, savedLocationId: dp.id, label: dp.name });
      setF((x) => ({ ...x, loadingContactName: x.loadingContactName || dp.contactPerson || '', loadingContactPhone: x.loadingContactPhone || dp.contactPhone || '' }));
    }
    if (dd) {
      setDelivery({ address: dd.address, latitude: dd.latitude, longitude: dd.longitude, city: dd.city ?? undefined, state: dd.state ?? undefined, pincode: dd.pincode ?? undefined, placeId: dd.placeId ?? undefined, savedLocationId: dd.id, label: dd.name });
      setF((x) => ({ ...x, deliveryContactName: x.deliveryContactName || dd.contactPerson || '', deliveryContactPhone: x.deliveryContactPhone || dd.contactPhone || '' }));
    }
    setDefaultsApplied(true);
  }, [savedData, saved, defaultsApplied, repeatId]);

  // Repeat booking: prefill from an earlier booking.
  useEffect(() => {
    if (!repeatId) return;
    api
      .post(`/bookings/${repeatId}/repeat`)
      .then(({ data }) => {
        const t = data.data.template;
        setPickup(t.pickup);
        setDelivery(t.delivery);
        const presets = [10, 12, 16, 20, 24, 30];
        setF((x) => ({
          ...x,
          productId: t.productId,
          capacity: presets.includes(t.tankerCapacityKl) ? String(t.tankerCapacityKl) : 'OTHER',
          customCapacity: presets.includes(t.tankerCapacityKl) ? '' : String(t.tankerCapacityKl),
          quantityKl: String(t.quantityKl ?? ''),
          numberOfTankers: String(t.numberOfTankers ?? 1),
          tankerTypeId: t.tankerTypeId ?? '',
          compartmentRequirement: t.compartmentRequirement ?? 'ANY',
          productCompatibility: t.productCompatibility ?? 'ANY_COMPATIBLE',
          specialRequirements: t.specialRequirements ?? '',
          loadingTime: t.loadingTime,
          loadingContactName: t.loadingContactName,
          loadingContactPhone: t.loadingContactPhone,
          loadingInstructions: t.loadingInstructions ?? '',
          deliveryContactName: t.deliveryContactName,
          deliveryContactPhone: t.deliveryContactPhone,
          deliveryInstructions: t.deliveryInstructions ?? '',
        }));
        setRepeatOf({ id: t.repeatedFromId, code: t.repeatedFromCode, previousOffer: t.previousAcceptedFreight ?? t.previousOffer });
        setDefaultsApplied(true);
      })
      .catch((e) => toast.error(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repeatId]);

  // Road routes whenever both points are set.
  useEffect(() => {
    setRoutes(null);
    setRouteError(null);
    setRouteIndex(0);
    if (!pickup || !delivery) return;
    let cancelled = false;
    setRouting(true);
    api
      .post('/maps/route', { origin: { latitude: pickup.latitude, longitude: pickup.longitude }, destination: { latitude: delivery.latitude, longitude: delivery.longitude } })
      .then(({ data }) => !cancelled && setRoutes(data.data))
      .catch((e) => !cancelled && setRouteError(parseApiError(e).message))
      .finally(() => !cancelled && setRouting(false));
    return () => {
      cancelled = true;
    };
  }, [pickup?.latitude, pickup?.longitude, delivery?.latitude, delivery?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

  // Freight quote (server-side road distance x configured rates).
  useEffect(() => {
    setQuote(null);
    if (!pickup || !delivery || !f.productId || !(capacityKl > 0) || !routes) return;
    let cancelled = false;
    setQuoting(true);
    const t = setTimeout(() => {
      api
        .post('/bookings/quote', {
          pickup: { latitude: pickup.latitude, longitude: pickup.longitude, state: pickup.state },
          delivery: { latitude: delivery.latitude, longitude: delivery.longitude, state: delivery.state },
          routeIndex,
          productId: f.productId,
          tankerCapacityKl: capacityKl,
          numberOfTankers: tankers,
          ...(f.tankerTypeId ? { tankerTypeId: f.tankerTypeId } : {}),
        })
        .then(({ data }) => !cancelled && setQuote(data.data))
        .catch((e) => !cancelled && toast.error(e))
        .finally(() => !cancelled && setQuoting(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [routes, routeIndex, f.productId, capacityKl, tankers, f.tankerTypeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const reverse = useCallback(
    async (which: 'pickup' | 'delivery', ll: LL) => {
      const setter = which === 'pickup' ? setPickup : setDelivery;
      setter((prev) => ({ ...(prev ?? { address: 'Locating…' }), latitude: ll.lat, longitude: ll.lng, savedLocationId: undefined, label: undefined, address: 'Finding address…' }));
      try {
        const { data } = await api.get('/maps/reverse', { params: { lat: ll.lat, lng: ll.lng } });
        const p = data.data.place;
        setter({ address: p.address, latitude: ll.lat, longitude: ll.lng, city: p.city ?? undefined, state: p.state ?? undefined, pincode: p.pincode ?? undefined, placeId: p.placeId ?? undefined });
      } catch (e) {
        setter({ address: `Pinned location (${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)})`, latitude: ll.lat, longitude: ll.lng });
        toast.error(e);
      }
    },
    [toast],
  );

  const product = catalog?.products.find((p) => p.id === f.productId);
  const offer = Number(f.customerOffer);
  const est = quote?.estimate;
  const diff = est && offer ? offer - est.suggestedFreight : null;
  const offerOutOfRange = Boolean(est && offer && (offer < est.offerMin || offer > est.offerMax));

  function validate(s: number): boolean {
    const e: Errors = {};
    if (s === 0) {
      if (!pickup) e.pickup = 'Choose the pickup location';
      if (!delivery) e.delivery = 'Choose the delivery location';
      if (pickup && delivery && !routes && !routing) e.route = routeError ?? 'Route could not be calculated';
    }
    if (s === 1) {
      if (!f.productId) e.productId = 'Select the product';
      if (!(capacityKl > 0) || capacityKl > 60) e.capacity = 'Enter a tanker capacity between 1 and 60 KL';
      const qty = Number(f.quantityKl);
      if (!(qty > 0)) e.quantityKl = 'Enter the quantity';
      else if (qty > capacityKl * tankers) e.quantityKl = `Exceeds total capacity (${capacityKl * tankers} KL)`;
      if (!(tankers >= 1) || tankers > (catalog?.settings.maxTankersPerBooking ?? 20)) e.numberOfTankers = `1 to ${catalog?.settings.maxTankersPerBooking ?? 20} tankers`;
    }
    if (s === 2) {
      if (!f.loadingDate || f.loadingDate < todayIST()) e.loadingDate = 'Choose today or a later date';
      if (!/^\d{2}:\d{2}$/.test(f.loadingTime)) e.loadingTime = 'Choose a time';
      if (!f.expectedDeliveryDate || f.expectedDeliveryDate < f.loadingDate) e.expectedDeliveryDate = 'Must be on or after the loading date';
      for (const [k, schema] of [
        ['loadingContactName', nameSchema],
        ['loadingContactPhone', phoneSchema],
        ['deliveryContactName', nameSchema],
        ['deliveryContactPhone', phoneSchema],
      ] as const) {
        const r = schema.safeParse(f[k]);
        if (!r.success) e[k] = r.error.issues[0].message;
      }
    }
    if (s === 3) {
      if (!est) e.customerOffer = 'Waiting for the freight estimate';
      else if (!(offer > 0)) e.customerOffer = 'Enter your freight offer';
      else if (offerOutOfRange) e.customerOffer = `Offer must be between ${inr(est.offerMin)} and ${inr(est.offerMax)}`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function goNext() {
    if (!validate(step)) return;
    setPickMode(null);
    if (step < STEPS.length - 1) setStep(step + 1);
    else setReviewOpen(true);
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body = {
        pickup: { ...pickup!, label: undefined },
        delivery: { ...delivery!, label: undefined },
        routeIndex,
        productId: f.productId,
        tankerCapacityKl: capacityKl,
        quantityKl: Number(f.quantityKl),
        numberOfTankers: tankers,
        ...(f.tankerTypeId ? { tankerTypeId: f.tankerTypeId } : {}),
        compartmentRequirement: f.compartmentRequirement,
        productCompatibility: f.productCompatibility,
        specialRequirements: f.specialRequirements || undefined,
        loadingDate: f.loadingDate,
        loadingTime: f.loadingTime,
        loadingContactName: f.loadingContactName,
        loadingContactPhone: f.loadingContactPhone,
        loadingInstructions: f.loadingInstructions || undefined,
        expectedDeliveryDate: f.expectedDeliveryDate,
        deliveryContactName: f.deliveryContactName,
        deliveryContactPhone: f.deliveryContactPhone,
        deliveryInstructions: f.deliveryInstructions || undefined,
        customerOffer: offer,
      };
      for (const l of [body.pickup, body.delivery]) delete (l as { label?: string }).label;
      const { data } = await api.post(`/bookings${repeatOf ? `?repeatOf=${repeatOf.id}` : ''}`, body);
      toast.success(`Booking ${data.data.booking.bookingCode} created. Searching for tankers.`);
      router.push(`/company/bookings/${data.data.booking.id}?created=1`);
    } catch (e) {
      setSubmitError(parseApiError(e).message);
      setSubmitting(false);
    }
  }

  const selectedRoute = routes?.routes[routeIndex];
  const mapRoutes = useMemo(() => routes?.routes.map((r) => ({ polyline: r.polyline })) ?? [], [routes]);

  return (
    <div>
      <PageHeader title="Book a Tanker" subtitle="Choose locations on the map, tell us your load, and name your freight price." />
      {companyStatus && companyStatus !== 'VERIFIED' && (
        <div className="mb-4">
          <Alert tone="info" title="Your company is not verified yet">
            You can prepare a booking and see the route and freight estimate. Submitting the request unlocks after verification —{' '}
            <Link href="/company/profile" className="font-semibold underline">
              complete your profile and documents
            </Link>
            .
          </Alert>
        </div>
      )}
      {repeatOf && (
        <div className="mb-4">
          <Alert tone="info">
            Repeating booking <strong>{repeatOf.code}</strong>. Locations, load and contacts are pre-filled — pick new dates and confirm your offer
            {repeatOf.previousOffer ? ` (last time: ${inr(repeatOf.previousOffer)})` : ''}.
          </Alert>
        </div>
      )}

      {/* Step indicator */}
      <ol className="mb-6 grid grid-cols-4 gap-2" aria-label="Booking steps">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <button
              type="button"
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              className={clsx('w-full rounded-xl border px-3 py-2 text-left transition-colors', i === step ? 'border-brand-600 bg-brand-50' : i < step ? 'border-green-200 bg-green-50 hover:border-green-300' : 'border-line bg-white')}
            >
              <span className="flex items-center gap-2 text-xs font-semibold text-ink">
                <span className={clsx('flex h-5 w-5 items-center justify-center rounded-full text-[10px]', i < step ? 'bg-green-600 text-white' : i === step ? 'bg-brand-600 text-white' : 'bg-slate-200 text-muted')}>
                  {i < step ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span className="truncate">{s.title}</span>
              </span>
              <span className="mt-0.5 hidden truncate text-[11px] text-muted md:block">{s.sub}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* LEFT: booking information */}
        <div className="space-y-5">
          {step === 0 && (
            <section className="space-y-5 rounded-2xl border border-line bg-white p-5 shadow-[var(--shadow-card)]">
              <div>
                <LocationSearch
                  label="Step 1 · Pickup location"
                  marker="A"
                  value={pickup}
                  onChange={(v) => {
                    setPickup(v);
                    if (v?.savedLocationId) {
                      const s = saved.find((x) => x.id === v.savedLocationId);
                      if (s?.contactPerson) setF((x) => ({ ...x, loadingContactName: s.contactPerson ?? '', loadingContactPhone: s.contactPhone ?? '' }));
                    }
                  }}
                  saved={saved}
                  picking={pickMode === 'pickup'}
                  onPickOnMap={() => setPickMode((m) => (m === 'pickup' ? null : 'pickup'))}
                  error={errors.pickup}
                />
                {pickup && !pickup.savedLocationId && (
                  <button type="button" onClick={() => setSaveFor('pickup')} className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700">
                    <BookmarkPlus className="h-3.5 w-3.5" /> Save this location
                  </button>
                )}
                <ManualAddress
                  open={manual.pickup !== null}
                  value={manual.pickup}
                  onToggle={() => setManual((m) => ({ ...m, pickup: m.pickup ? null : { address: '', city: '', state: '', pincode: '' } }))}
                  onChange={(v) => setManual((m) => ({ ...m, pickup: v }))}
                  onPlacePin={() => setPickMode('pickup')}
                  picking={pickMode === 'pickup'}
                />
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <TextField label="Pickup contact person" value={f.loadingContactName} onChange={(e) => set('loadingContactName', e.target.value)} error={errors.loadingContactName} />
                  <TextField label="Mobile" prefix="+91" inputMode="numeric" value={f.loadingContactPhone} onChange={(e) => set('loadingContactPhone', e.target.value)} error={errors.loadingContactPhone} />
                </div>
              </div>
              <div>
                <LocationSearch
                  label="Step 2 · Delivery location"
                  marker="B"
                  value={delivery}
                  onChange={(v) => {
                    setDelivery(v);
                    if (v?.savedLocationId) {
                      const s = saved.find((x) => x.id === v.savedLocationId);
                      if (s?.contactPerson) setF((x) => ({ ...x, deliveryContactName: s.contactPerson ?? '', deliveryContactPhone: s.contactPhone ?? '' }));
                    }
                  }}
                  saved={saved}
                  picking={pickMode === 'delivery'}
                  onPickOnMap={() => setPickMode((m) => (m === 'delivery' ? null : 'delivery'))}
                  error={errors.delivery}
                />
                {delivery && !delivery.savedLocationId && (
                  <button type="button" onClick={() => setSaveFor('delivery')} className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700">
                    <BookmarkPlus className="h-3.5 w-3.5" /> Save this location
                  </button>
                )}
                <ManualAddress
                  open={manual.delivery !== null}
                  value={manual.delivery}
                  onToggle={() => setManual((m) => ({ ...m, delivery: m.delivery ? null : { address: '', city: '', state: '', pincode: '' } }))}
                  onChange={(v) => setManual((m) => ({ ...m, delivery: v }))}
                  onPlacePin={() => setPickMode('delivery')}
                  picking={pickMode === 'delivery'}
                />
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <TextField label="Delivery contact person" value={f.deliveryContactName} onChange={(e) => set('deliveryContactName', e.target.value)} error={errors.deliveryContactName} />
                  <TextField label="Mobile" prefix="+91" inputMode="numeric" value={f.deliveryContactPhone} onChange={(e) => set('deliveryContactPhone', e.target.value)} error={errors.deliveryContactPhone} />
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-ink">Step 3 · Road route</p>
                {!pickup || !delivery ? (
                  <p className="rounded-xl bg-canvas p-4 text-sm text-muted">Choose both locations to see the road distance and journey time.</p>
                ) : routing ? (
                  <p className="flex items-center gap-2 rounded-xl bg-canvas p-4 text-sm text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" /> Calculating road route…
                  </p>
                ) : routeError ? (
                  <Alert>{routeError}</Alert>
                ) : routes ? (
                  <div className="space-y-2">
                    {routes.routes.map((r) => (
                      <button
                        key={r.index}
                        type="button"
                        onClick={() => setRouteIndex(r.index)}
                        className={clsx('flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors', r.index === routeIndex ? 'border-brand-600 bg-brand-50' : 'border-line hover:border-brand-200')}
                      >
                        <Route className={clsx('h-5 w-5 shrink-0', r.index === routeIndex ? 'text-brand-600' : 'text-muted')} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-ink">
                            {km(r.distanceKm)} · {duration(r.durationMinutes)}
                          </span>
                          <span className="block truncate text-xs text-muted">{r.index === 0 ? 'Recommended · ' : 'Alternative · '}{r.summary}</span>
                        </span>
                        {r.index === routeIndex && <Check className="h-4 w-4 text-brand-600" />}
                      </button>
                    ))}
                    <p className="text-xs text-muted">
                      Road distance from {routes.providerLabel}. Journey time is adjusted for a loaded tanker (×{catalog?.settings.heavyVehicleEtaFactor ?? 1.3}).
                    </p>
                  </div>
                ) : null}
                {errors.route && <p className="mt-1 text-xs font-medium text-danger">{errors.route}</p>}
              </div>
            </section>
          )}

          {step === 1 && (
            <section className="space-y-5 rounded-2xl border border-line bg-white p-5 shadow-[var(--shadow-card)]">
              <div>
                <p className="mb-2 text-sm font-medium text-ink">Step 4 · Oil / product <span className="text-danger">*</span></p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {catalog?.products.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => set('productId', p.id)}
                      className={clsx('rounded-xl border p-3 text-left transition-colors', f.productId === p.id ? 'border-brand-600 bg-brand-50' : 'border-line hover:border-brand-200')}
                    >
                      <span className="block text-sm font-semibold text-ink">{p.name}</span>
                      <span className="block text-xs text-muted">{p.description}</span>
                    </button>
                  ))}
                </div>
                {errors.productId && <p className="mt-1 text-xs font-medium text-danger">{errors.productId}</p>}
                {product?.requiresSpecialApproval && <p className="mt-2 text-xs text-orange-700">This product needs operations approval; transporters will confirm compatibility in their offers.</p>}
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-ink">Step 5 · Tanker requirements</p>
                <div className="mb-3 flex flex-wrap gap-2">
                  {[...(catalog?.capacities ?? [10, 12, 16, 20, 24, 30]).map(String), 'OTHER'].map((c) => (
                    <button key={c} type="button" onClick={() => set('capacity', c)} className={clsx('rounded-full border px-4 py-1.5 text-sm font-semibold', f.capacity === c ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink hover:border-brand-300')}>
                      {c === 'OTHER' ? 'Other' : `${c} KL`}
                    </button>
                  ))}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {f.capacity === 'OTHER' && <TextField label="Tanker capacity (KL)" type="number" min={1} max={60} value={f.customCapacity} onChange={(e) => set('customCapacity', e.target.value)} error={errors.capacity} required />}
                  <TextField label="Required quantity (KL)" type="number" min={0.5} step={0.5} value={f.quantityKl} onChange={(e) => set('quantityKl', e.target.value)} error={errors.quantityKl} hint={capacityKl > 0 ? `Up to ${capacityKl * tankers} KL with ${tankers} tanker(s)` : undefined} required />
                  <TextField label="Number of tankers" type="number" min={1} max={catalog?.settings.maxTankersPerBooking ?? 20} value={f.numberOfTankers} onChange={(e) => set('numberOfTankers', e.target.value)} error={errors.numberOfTankers} required />
                  <SelectField label="Tanker type" value={f.tankerTypeId} onChange={(e) => set('tankerTypeId', e.target.value)} options={[{ value: '', label: 'Any suitable type' }, ...(catalog?.tankerTypes.map((t) => ({ value: t.id, label: t.name })) ?? [])]} />
                  <SelectField label="Compartments" value={f.compartmentRequirement} onChange={(e) => set('compartmentRequirement', e.target.value)} options={Object.entries(COMPARTMENTS).map(([value, label]) => ({ value, label }))} />
                  <SelectField label="Product compatibility" value={f.productCompatibility} onChange={(e) => set('productCompatibility', e.target.value)} options={Object.entries(PRODUCT_COMPATIBILITY).map(([value, label]) => ({ value, label }))} />
                </div>
                <div className="mt-4">
                  <TextArea label="Special requirements" value={f.specialRequirements} onChange={(e) => set('specialRequirements', e.target.value)} placeholder="e.g. Bottom loading, earthing cable, tank cleaning certificate" maxLength={1000} />
                </div>
                <p className="mt-3 flex items-start gap-2 text-xs text-muted">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Only transporters whose tankers are certified for the selected product and capacity are matched.
                </p>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="space-y-5 rounded-2xl border border-line bg-white p-5 shadow-[var(--shadow-card)]">
              <div>
                <p className="mb-3 text-sm font-medium text-ink">Step 6 · Loading information</p>
                <p className="mb-3 rounded-lg bg-canvas px-3 py-2 text-sm text-muted">
                  <span className="font-medium text-ink">Loading location:</span> {pickup?.label ? `${pickup.label} — ` : ''}
                  {pickup?.address}
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="Loading date" type="date" min={todayIST()} value={f.loadingDate} onChange={(e) => set('loadingDate', e.target.value)} error={errors.loadingDate} required />
                  <TextField label="Loading time" type="time" value={f.loadingTime} onChange={(e) => set('loadingTime', e.target.value)} error={errors.loadingTime} required />
                  <TextField label="Loading contact person" value={f.loadingContactName} onChange={(e) => set('loadingContactName', e.target.value)} error={errors.loadingContactName} required />
                  <TextField label="Contact number" prefix="+91" inputMode="numeric" value={f.loadingContactPhone} onChange={(e) => set('loadingContactPhone', e.target.value)} error={errors.loadingContactPhone} required />
                </div>
                <div className="mt-4">
                  <TextArea label="Loading instructions" value={f.loadingInstructions} onChange={(e) => set('loadingInstructions', e.target.value)} placeholder="Gate number, safety requirements, documents to carry" maxLength={1000} />
                </div>
              </div>
              <div className="border-t border-line pt-5">
                <p className="mb-3 text-sm font-medium text-ink">Step 7 · Delivery information</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="Expected delivery date" type="date" min={f.loadingDate} value={f.expectedDeliveryDate} onChange={(e) => set('expectedDeliveryDate', e.target.value)} error={errors.expectedDeliveryDate} hint={selectedRoute ? `Estimated journey ${duration(selectedRoute.durationMinutes)}` : undefined} required />
                  <span className="hidden sm:block" />
                  <TextField label="Delivery contact person" value={f.deliveryContactName} onChange={(e) => set('deliveryContactName', e.target.value)} error={errors.deliveryContactName} required />
                  <TextField label="Contact number" prefix="+91" inputMode="numeric" value={f.deliveryContactPhone} onChange={(e) => set('deliveryContactPhone', e.target.value)} error={errors.deliveryContactPhone} required />
                </div>
                <div className="mt-4">
                  <TextArea label="Delivery instructions" value={f.deliveryInstructions} onChange={(e) => set('deliveryInstructions', e.target.value)} placeholder="Unloading hours, access restrictions" maxLength={1000} />
                </div>
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="space-y-5 rounded-2xl border border-line bg-white p-5 shadow-[var(--shadow-card)]">
              <div>
                <p className="mb-3 text-sm font-medium text-ink">Step 8 · Freight calculation</p>
                {quoting || !quote ? (
                  <p className="flex items-center gap-2 rounded-xl bg-canvas p-4 text-sm text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" /> Calculating indicative freight…
                  </p>
                ) : (
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      ['Total distance', km(quote.selectedRoute.distanceKm)],
                      ['Estimated time', duration(quote.selectedRoute.durationMinutes)],
                      ['Tanker capacity', `${capacityKl} KL × ${tankers}`],
                      ['Rate applied', `${inr(quote.estimate.ratePerKm)}/km · ${quote.estimate.ruleName}`],
                      ['Distance freight / tanker', inr(quote.estimate.distanceFreight)],
                      [quote.estimate.additionalChargeLabel ? `${quote.estimate.additionalChargeLabel} / tanker` : 'Additional charges / tanker', inr(quote.estimate.additionalChargePerTanker)],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-xl bg-canvas p-3">
                        <dt className="text-xs text-muted">{k}</dt>
                        <dd className="mt-0.5 font-semibold text-ink">{v}</dd>
                      </div>
                    ))}
                    <div className="col-span-2 rounded-xl border border-brand-200 bg-brand-50 p-4">
                      <dt className="text-xs font-medium uppercase tracking-wide text-brand-700">Suggested freight (estimate)</dt>
                      <dd className="mt-1 text-2xl font-bold text-ink">{inr(quote.estimate.suggestedFreight)}</dd>
                      <p className="mt-1 text-xs text-muted">{quote.estimate.disclaimer}</p>
                    </div>
                  </dl>
                )}
              </div>
              <div className="border-t border-line pt-5">
                <label htmlFor="offer" className="mb-2 block text-sm font-semibold uppercase tracking-wide text-ink">
                  Step 9 · Your freight offer
                </label>
                <div className={clsx('flex items-center rounded-2xl border-2 bg-white px-4 focus-within:ring-4 focus-within:ring-brand-100', errors.customerOffer || offerOutOfRange ? 'border-danger' : 'border-brand-600')}>
                  <span className="text-3xl font-bold text-ink">₹</span>
                  <input
                    id="offer"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={f.customerOffer}
                    onChange={(e) => set('customerOffer', e.target.value)}
                    placeholder={est ? String(Math.round(est.suggestedFreight)) : ''}
                    className="h-16 w-full bg-transparent px-2 text-3xl font-bold tabular-nums text-ink outline-none"
                  />
                </div>
                {est && (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                    <div className="rounded-xl bg-canvas p-2">
                      <p className="text-xs text-muted">Suggested</p>
                      <p className="font-semibold">{inr(est.suggestedFreight)}</p>
                    </div>
                    <div className="rounded-xl bg-canvas p-2">
                      <p className="text-xs text-muted">Your offer</p>
                      <p className="font-semibold">{offer ? inr(offer) : '—'}</p>
                    </div>
                    <div className="rounded-xl bg-canvas p-2">
                      <p className="text-xs text-muted">Difference</p>
                      <p className={clsx('font-semibold', diff === null ? '' : diff < 0 ? 'text-green-700' : diff > 0 ? 'text-orange-700' : '')}>
                        {diff === null ? '—' : `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${inr(Math.abs(diff))} (${((diff / est.suggestedFreight) * 100).toFixed(1)}%)`}
                      </p>
                    </div>
                  </div>
                )}
                {est && (
                  <p className="mt-2 text-xs text-muted">
                    Allowed range {inr(est.offerMin)} – {inr(est.offerMax)}. Transporters can accept your price or send a counter-offer; offers stay open {catalog?.settings.offerExpiryHours ?? 24} h.
                  </p>
                )}
                {errors.customerOffer && <p className="mt-1 text-xs font-medium text-danger">{errors.customerOffer}</p>}
                {est && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[0.95, 1, 1.05].map((m) => (
                      <button key={m} type="button" onClick={() => set('customerOffer', String(Math.round((est.suggestedFreight * m) / 10) * 10))} className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink hover:border-brand-300">
                        {m === 1 ? 'Use suggested' : `${m < 1 ? '−' : '+'}5%`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          <div className="flex items-center justify-between gap-3">
            <Button variant="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={goNext} disabled={step === 0 && routing}>
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={goNext} className="px-8 text-base tracking-wide" disabled={quoting}>
                <Search className="h-4 w-4" /> SUBMIT BOOKING REQUEST
              </Button>
            )}
          </div>
        </div>

        {/* RIGHT: map (below the form on mobile) */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <MapView
            className="h-80 sm:h-[420px] lg:h-[calc(100dvh-8rem)]"
            pickup={pickup ? { lat: pickup.latitude, lng: pickup.longitude } : null}
            delivery={delivery ? { lat: delivery.latitude, lng: delivery.longitude } : null}
            routes={mapRoutes}
            selectedRoute={routeIndex}
            onSelectRoute={setRouteIndex}
            draggable={step === 0}
            onPickupMove={(ll) => reverse('pickup', ll)}
            onDeliveryMove={(ll) => reverse('delivery', ll)}
            pickMode={pickMode}
            onPick={(mode, ll) => {
              setPickMode(null);
              const m = manual[mode];
              if (m && m.address.trim().length >= 5) {
                const setter = mode === 'pickup' ? setPickup : setDelivery;
                setter({ address: m.address.trim(), latitude: ll.lat, longitude: ll.lng, city: m.city || undefined, state: m.state || undefined, pincode: /^[1-9]\d{5}$/.test(m.pincode) ? m.pincode : undefined });
                setManual((x) => ({ ...x, [mode]: null }));
              } else {
                void reverse(mode, ll);
              }
            }}
          />
          {selectedRoute && (
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border border-line bg-white p-2.5">
                <Route className="mx-auto h-4 w-4 text-brand-600" />
                <p className="mt-1 text-sm font-semibold">{km(selectedRoute.distanceKm)}</p>
                <p className="text-[11px] text-muted">Road distance</p>
              </div>
              <div className="rounded-xl border border-line bg-white p-2.5">
                <Clock className="mx-auto h-4 w-4 text-brand-600" />
                <p className="mt-1 text-sm font-semibold">{duration(selectedRoute.durationMinutes)}</p>
                <p className="text-[11px] text-muted">Est. journey</p>
              </div>
              <div className="rounded-xl border border-line bg-white p-2.5">
                <Truck className="mx-auto h-4 w-4 text-brand-600" />
                <p className="mt-1 text-sm font-semibold">{est ? inr(est.suggestedFreight) : '—'}</p>
                <p className="text-[11px] text-muted">Suggested freight</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <SaveLocationDialog
        open={saveFor !== null}
        onClose={() => setSaveFor(null)}
        location={saveFor === 'pickup' ? pickup : saveFor === 'delivery' ? delivery : null}
        defaultType={saveFor === 'pickup' ? 'FACTORY' : 'DELIVERY_POINT'}
        onSaved={(s) => {
          void reloadSaved();
          const v = { address: s.address, latitude: s.latitude, longitude: s.longitude, city: s.city ?? undefined, state: s.state ?? undefined, pincode: s.pincode ?? undefined, placeId: s.placeId ?? undefined, savedLocationId: s.id, label: s.name };
          if (saveFor === 'pickup') setPickup(v);
          else setDelivery(v);
        }}
      />

      <Modal
        open={reviewOpen}
        onClose={() => !submitting && setReviewOpen(false)}
        title="Review your booking"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setReviewOpen(false)} disabled={submitting}>
              Edit details
            </Button>
            <Button onClick={submit} loading={submitting} disabled={!canSubmit}>
              <Search className="h-4 w-4" /> SUBMIT BOOKING REQUEST
            </Button>
          </>
        }
      >
        {submitError && (
          <div className="mb-4">
            <Alert>{submitError}</Alert>
          </div>
        )}
        {!canSubmit && companyStatus && (
          <div className="mb-4">
            <Alert tone="info" title="Verification required">
              Booking requests can be submitted once your company is verified. Complete your profile and upload your GST certificate and PAN card in{' '}
              <Link href="/company/profile" className="font-semibold underline">
                Company Profile
              </Link>
              .
            </Alert>
          </div>
        )}
        <dl className="divide-y divide-line text-sm">
          {[
            ['Pickup', `${pickup?.label ? `${pickup.label} — ` : ''}${pickup?.address ?? ''}`],
            ['Delivery', `${delivery?.label ? `${delivery.label} — ` : ''}${delivery?.address ?? ''}`],
            ['Route', selectedRoute ? `${km(selectedRoute.distanceKm)} · ${duration(selectedRoute.durationMinutes)} · ${selectedRoute.summary}` : ''],
            ['Product', product?.name ?? ''],
            ['Tankers', `${tankers} × ${capacityKl} KL${f.tankerTypeId ? ` · ${catalog?.tankerTypes.find((t) => t.id === f.tankerTypeId)?.name}` : ''} · ${f.quantityKl} KL total`],
            ['Compatibility', PRODUCT_COMPATIBILITY[f.productCompatibility]],
            ['Loading', `${f.loadingDate} at ${f.loadingTime} · ${f.loadingContactName} (${f.loadingContactPhone})`],
            ['Delivery by', `${f.expectedDeliveryDate} · ${f.deliveryContactName} (${f.deliveryContactPhone})`],
            ['Suggested freight', est ? inr(est.suggestedFreight) : ''],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
              <dt className="w-36 shrink-0 text-muted">{k}</dt>
              <dd className="font-medium text-ink">{v}</dd>
            </div>
          ))}
          <div className="flex items-center justify-between py-3">
            <dt className="font-semibold text-ink">Your freight offer</dt>
            <dd className="text-xl font-bold text-brand-700">{inr(offer)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted">Verified transporters with compatible tankers will be notified. You can compare offers, negotiate and confirm one transporter.</p>
      </Modal>
    </div>
  );
}

/** Manual address entry: type the address, then drop the pin on the map for exact coordinates. */
function ManualAddress({
  open,
  value,
  onToggle,
  onChange,
  onPlacePin,
  picking,
}: {
  open: boolean;
  value: { address: string; city: string; state: string; pincode: string } | null;
  onToggle: () => void;
  onChange: (v: { address: string; city: string; state: string; pincode: string }) => void;
  onPlacePin: () => void;
  picking: boolean;
}) {
  return (
    <div className="mt-2">
      <button type="button" onClick={onToggle} className="text-xs font-semibold text-brand-600 hover:text-brand-700">
        {open ? 'Cancel manual entry' : 'Enter address manually'}
      </button>
      {open && value && (
        <div className="mt-2 space-y-3 rounded-xl border border-dashed border-line bg-canvas/50 p-3">
          <TextArea label="Address" rows={2} value={value.address} onChange={(e) => onChange({ ...value, address: e.target.value })} placeholder="Plot / building, street, area" />
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label="City" value={value.city} onChange={(e) => onChange({ ...value, city: e.target.value })} />
            <TextField label="State" value={value.state} onChange={(e) => onChange({ ...value, state: e.target.value })} />
            <TextField label="PIN code" inputMode="numeric" maxLength={6} value={value.pincode} onChange={(e) => onChange({ ...value, pincode: e.target.value })} />
          </div>
          <Button size="sm" variant="secondary" onClick={onPlacePin} disabled={value.address.trim().length < 5}>
            {picking ? 'Click the exact spot on the map…' : 'Place pin on map to save this address'}
          </Button>
          <p className="text-xs text-muted">A map pin is required so the road distance can be calculated.</p>
        </div>
      )}
    </div>
  );
}
