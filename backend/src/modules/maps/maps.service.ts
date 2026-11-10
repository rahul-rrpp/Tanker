import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { AppError, ErrorCode } from '../../utils/errors';
import { encodePolyline, haversineKm, type LatLng } from '../../utils/polyline';
import { getSettings } from '../settings/settings.service';

/**
 * Maps provider abstraction.
 *  - google  : Places API (New) autocomplete/details, Geocoding API, Routes API (computeRoutes).
 *              Used whenever GOOGLE_MAPS_SERVER_KEY is set. The key never leaves the server.
 *  - osm     : development fallback - Photon (OpenStreetMap) geocoding + OSRM road routing.
 *              Still real ROAD distance; labelled as a development provider in every response.
 *  - fixture : automated tests only (deterministic, no network). Rejected in production.
 * Straight-line distance is never returned as road distance.
 */

export interface PlaceSuggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string;
  /** Present for providers that return coordinates with suggestions (osm). */
  location?: PlaceDetails;
}

export interface PlaceDetails {
  placeId: string | null;
  address: string;
  latitude: number;
  longitude: number;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

export interface RouteOption {
  index: number;
  distanceKm: number;
  /** Raw road ETA from the provider (car profile). */
  baseDurationMinutes: number;
  /** ETA adjusted for a loaded tanker (heavyVehicleEtaFactor). */
  durationMinutes: number;
  polyline: string;
  summary: string;
}

export interface RouteResult {
  provider: 'google' | 'osm-osrm' | 'fixture-test';
  providerLabel: string;
  routes: RouteOption[];
}

type Provider = 'google' | 'osm' | 'fixture';

export function activeProvider(): Provider | 'none' {
  if (env.GOOGLE_MAPS_SERVER_KEY) return 'google';
  return env.MAPS_FALLBACK_PROVIDER;
}

function requireProvider(): Provider {
  const p = activeProvider();
  if (p === 'none') throw new AppError(503, ErrorCode.MAPS_UNAVAILABLE, 'Maps are not configured. Set GOOGLE_MAPS_SERVER_KEY.');
  return p;
}

async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    logger.warn({ err, url: url.split('?')[0] }, 'Maps provider unreachable');
    throw new AppError(503, ErrorCode.MAPS_UNAVAILABLE, 'Maps service is temporarily unavailable. Please try again.');
  }
  if (!res.ok) {
    logger.warn({ status: res.status, url: url.split('?')[0], body: (await res.text().catch(() => '')).slice(0, 300) }, 'Maps provider error');
    throw new AppError(503, ErrorCode.MAPS_UNAVAILABLE, 'Maps service returned an error. Please try again.');
  }
  return (await res.json()) as T;
}

// ---- small TTL cache (protects provider quota) --------------------------------------------

class TtlCache<V> {
  private map = new Map<string, { at: number; v: V }>();
  constructor(private max: number, private ttlMs: number) {}
  get(k: string): V | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (Date.now() - e.at > this.ttlMs) {
      this.map.delete(k);
      return undefined;
    }
    return e.v;
  }
  set(k: string, v: V) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    this.map.set(k, { at: Date.now(), v });
  }
}

const routeCache = new TtlCache<RouteResult>(500, 60 * 60_000);
const searchCache = new TtlCache<PlaceSuggestion[]>(1000, 10 * 60_000);
const placeCache = new TtlCache<PlaceDetails>(2000, 60 * 60_000);

const INDIA_BBOX = '68.1,6.5,97.4,35.7';

// ---- Places ---------------------------------------------------------------------------------

export async function searchPlaces(query: string, sessionToken?: string): Promise<PlaceSuggestion[]> {
  const provider = requireProvider();
  const key = `${provider}|${query.toLowerCase()}`;
  const cached = searchCache.get(key);
  if (cached) return cached;
  let out: PlaceSuggestion[];

  if (provider === 'google') {
    type R = { suggestions?: { placePrediction?: { placeId: string; text?: { text: string }; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } } } }[] };
    const data = await fetchJson<R>('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_MAPS_SERVER_KEY! },
      body: JSON.stringify({ input: query, includedRegionCodes: ['in'], languageCode: 'en', ...(sessionToken ? { sessionToken } : {}) }),
    });
    out = (data.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({
        placeId: p.placeId,
        primaryText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
        secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
      }));
  } else if (provider === 'osm') {
    type F = { geometry: { coordinates: [number, number] }; properties: Record<string, string | undefined> };
    const url = `${env.PHOTON_URL}/api/?q=${encodeURIComponent(query)}&limit=7&lang=en&bbox=${INDIA_BBOX}`;
    const data = await fetchJson<{ features: F[] }>(url, { headers: { 'User-Agent': env.MAPS_USER_AGENT } });
    out = data.features
      .filter((f) => (f.properties.countrycode ?? 'IN').toUpperCase() === 'IN')
      .map((f) => {
        const details = photonToDetails(f);
        placeCache.set(details.placeId!, details);
        const pr = f.properties;
        return {
          placeId: details.placeId!,
          primaryText: pr.name ?? [pr.housenumber, pr.street].filter(Boolean).join(' ') ?? details.address,
          secondaryText: [pr.district ?? pr.locality, pr.city, pr.state, pr.postcode].filter(Boolean).join(', '),
          location: details,
        };
      });
  } else {
    out = fixturePlaces(query);
  }
  searchCache.set(key, out);
  return out;
}

function photonToDetails(f: { geometry: { coordinates: [number, number] }; properties: Record<string, string | undefined> }): PlaceDetails {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  const parts = [p.name, [p.housenumber, p.street].filter(Boolean).join(' '), p.district ?? p.locality, p.city, p.state, p.postcode]
    .filter((x): x is string => Boolean(x && x.trim()));
  const pin = p.postcode && /^[1-9]\d{5}$/.test(p.postcode) ? p.postcode : null;
  return {
    placeId: `osm:${p.osm_type ?? 'X'}${p.osm_id ?? `${lat.toFixed(5)},${lng.toFixed(5)}`}`,
    address: [...new Set(parts)].join(', '),
    latitude: Number(lat.toFixed(6)),
    longitude: Number(lng.toFixed(6)),
    city: p.city ?? p.county ?? p.district ?? null,
    state: p.state ?? null,
    pincode: pin,
  };
}

type GoogleComponent = { longText?: string; long_name?: string; types: string[] };
function fromGoogleComponents(components: GoogleComponent[] = []) {
  const get = (type: string) => {
    const c = components.find((x) => x.types.includes(type));
    return c ? (c.longText ?? c.long_name ?? null) : null;
  };
  const pin = get('postal_code');
  return {
    city: get('locality') ?? get('administrative_area_level_3') ?? get('administrative_area_level_2'),
    state: get('administrative_area_level_1'),
    pincode: pin && /^[1-9]\d{5}$/.test(pin) ? pin : null,
  };
}

export async function placeDetails(placeId: string, sessionToken?: string): Promise<PlaceDetails> {
  const provider = requireProvider();
  const cached = placeCache.get(placeId);
  if (cached) return cached;
  if (provider !== 'google') throw AppError.notFound('Place not found. Search again.');
  type R = { id: string; formattedAddress: string; location: { latitude: number; longitude: number }; addressComponents?: GoogleComponent[] };
  const qs = new URLSearchParams({ languageCode: 'en', ...(sessionToken ? { sessionToken } : {}) });
  const data = await fetchJson<R>(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?${qs}`, {
    headers: { 'X-Goog-Api-Key': env.GOOGLE_MAPS_SERVER_KEY!, 'X-Goog-FieldMask': 'id,formattedAddress,location,addressComponents' },
  });
  const details: PlaceDetails = {
    placeId: data.id,
    address: data.formattedAddress,
    latitude: data.location.latitude,
    longitude: data.location.longitude,
    ...fromGoogleComponents(data.addressComponents),
  };
  placeCache.set(placeId, details);
  return details;
}

export async function reverseGeocode(lat: number, lng: number): Promise<PlaceDetails> {
  const provider = requireProvider();
  if (provider === 'google') {
    type R = { results: { place_id: string; formatted_address: string; address_components: GoogleComponent[] }[]; status: string };
    const data = await fetchJson<R>(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=en&key=${encodeURIComponent(env.GOOGLE_MAPS_SERVER_KEY!)}`,
    );
    const r = data.results[0];
    if (!r) return { placeId: null, address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, latitude: lat, longitude: lng, city: null, state: null, pincode: null };
    return { placeId: r.place_id, address: r.formatted_address, latitude: lat, longitude: lng, ...fromGoogleComponents(r.address_components) };
  }
  if (provider === 'osm') {
    type F = { geometry: { coordinates: [number, number] }; properties: Record<string, string | undefined> };
    const data = await fetchJson<{ features: F[] }>(`${env.PHOTON_URL}/reverse?lat=${lat}&lon=${lng}&lang=en`, { headers: { 'User-Agent': env.MAPS_USER_AGENT } });
    const f = data.features[0];
    if (!f) return { placeId: null, address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, latitude: lat, longitude: lng, city: null, state: null, pincode: null };
    // Keep the exact pin position the user chose; only the address text comes from the geocoder.
    return { ...photonToDetails(f), latitude: lat, longitude: lng };
  }
  return { placeId: null, address: `Pinned location (${lat.toFixed(5)}, ${lng.toFixed(5)})`, latitude: lat, longitude: lng, city: 'Test City', state: 'Maharashtra', pincode: '411001' };
}

// ---- Routes ---------------------------------------------------------------------------------

const keyOf = (a: LatLng, b: LatLng) => `${a.lat.toFixed(5)},${a.lng.toFixed(5)}>${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;

export async function computeRoutes(origin: LatLng, destination: LatLng): Promise<RouteResult> {
  const provider = requireProvider();
  const cacheKey = `${provider}|${keyOf(origin, destination)}`;
  const cached = routeCache.get(cacheKey);
  if (cached) return cached;
  if (origin.lat === destination.lat && origin.lng === destination.lng) {
    throw AppError.badRequest('Pickup and delivery locations must be different', ErrorCode.ROUTE_NOT_FOUND);
  }
  const { heavyVehicleEtaFactor } = await getSettings();
  const adjust = (mins: number) => Math.max(1, Math.round(mins * heavyVehicleEtaFactor));
  let result: RouteResult;

  if (provider === 'google') {
    type R = { routes?: { distanceMeters: number; duration: string; polyline: { encodedPolyline: string }; description?: string }[] };
    const data = await fetchJson<R>('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.GOOGLE_MAPS_SERVER_KEY!,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.description',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
        computeAlternativeRoutes: true,
        units: 'METRIC',
        regionCode: 'IN',
        languageCode: 'en',
      }),
    });
    result = {
      provider: 'google',
      providerLabel: 'Google Maps Routes API',
      routes: (data.routes ?? []).map((r, index) => {
        const base = Math.round(Number.parseInt(r.duration, 10) / 60);
        return {
          index,
          distanceKm: Math.round(r.distanceMeters / 10) / 100,
          baseDurationMinutes: base,
          durationMinutes: adjust(base),
          polyline: r.polyline.encodedPolyline,
          summary: r.description || `Route ${index + 1}`,
        };
      }),
    };
  } else if (provider === 'osm') {
    type R = { code: string; routes?: { distance: number; duration: number; geometry: string; legs?: { summary?: string }[] }[] };
    const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
    const data = await fetchJson<R>(`${env.OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=polyline&alternatives=true&steps=false`, {
      headers: { 'User-Agent': env.MAPS_USER_AGENT },
    });
    if (data.code !== 'Ok') throw AppError.badRequest('No road route found between these locations', ErrorCode.ROUTE_NOT_FOUND);
    result = {
      provider: 'osm-osrm',
      providerLabel: 'OpenStreetMap / OSRM road routing (development provider)',
      routes: (data.routes ?? []).map((r, index) => {
        const base = Math.round(r.duration / 60);
        return {
          index,
          distanceKm: Math.round(r.distance / 10) / 100,
          baseDurationMinutes: base,
          durationMinutes: adjust(base),
          polyline: r.geometry,
          summary: r.legs?.[0]?.summary ? `Via ${r.legs[0].summary}` : `Route ${index + 1}`,
        };
      }),
    };
  } else {
    result = fixtureRoute(origin, destination, adjust);
  }

  if (result.routes.length === 0) throw AppError.badRequest('No road route found between these locations', ErrorCode.ROUTE_NOT_FOUND);
  routeCache.set(cacheKey, result);
  return result;
}

// ---- Test fixture (NODE_ENV=test only) ---------------------------------------------------------

function fixturePlaces(query: string): PlaceSuggestion[] {
  const base: PlaceDetails = { placeId: 'fixture:1', address: `${query}, Pune, Maharashtra 411001`, latitude: 18.5204, longitude: 73.8567, city: 'Pune', state: 'Maharashtra', pincode: '411001' };
  return [{ placeId: base.placeId!, primaryText: query, secondaryText: 'Pune, Maharashtra (test fixture)', location: base }];
}

function fixtureRoute(a: LatLng, b: LatLng, adjust: (m: number) => number): RouteResult {
  if (!env.isTest) throw new AppError(503, ErrorCode.MAPS_UNAVAILABLE, 'Fixture routing is only available in automated tests');
  // Deterministic synthetic road path for tests: a dog-leg through an offset waypoint.
  const mid = { lat: (a.lat + b.lat) / 2 + 0.05, lng: (a.lng + b.lng) / 2 - 0.05 };
  const km = Math.round((haversineKm(a, mid) + haversineKm(mid, b)) * 1.15 * 100) / 100;
  const base = Math.round((km / 45) * 60);
  return {
    provider: 'fixture-test',
    providerLabel: 'Test fixture routing (automated tests only)',
    routes: [{ index: 0, distanceKm: km, baseDurationMinutes: base, durationMinutes: adjust(base), polyline: encodePolyline([a, mid, b]), summary: 'Test route' }],
  };
}
