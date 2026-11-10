'use client';

import 'leaflet/dist/leaflet.css';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { decodePolyline } from '@/lib/useApi';

/**
 * Map renderer with two interchangeable engines:
 *  - Google Maps JavaScript API when NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY is set. This is the *browser*
 *    key (public by design, restricted by HTTP referrer in Google Cloud). The server key used for
 *    Places/Routes never reaches the browser.
 *  - Leaflet + OpenStreetMap tiles otherwise (development fallback, labelled on the map).
 * Routes always come from the backend (road routing), never computed here.
 */

export type LL = { lat: number; lng: number };

export interface MapViewProps {
  pickup?: LL | null;
  delivery?: LL | null;
  routes?: { polyline: string }[];
  selectedRoute?: number;
  onSelectRoute?: (index: number) => void;
  breadcrumb?: LL[];
  vehicle?: (LL & { heading?: number | null }) | null;
  /** Other vehicles shown at once (fleet view). Clicking one selects it. */
  markers?: (LL & { id: string })[];
  onMarker?: (id: string) => void;
  draggable?: boolean;
  onPickupMove?: (ll: LL) => void;
  onDeliveryMove?: (ll: LL) => void;
  pickMode?: 'pickup' | 'delivery' | null;
  onPick?: (mode: 'pickup' | 'delivery', ll: LL) => void;
  className?: string;
  /** Re-fit the viewport when this key changes (e.g. trip id). */
  fitKey?: string;
}

const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
const INDIA_CENTER: LL = { lat: 21.5, lng: 78.9 };
const BLUE = '#2563eb';
const ALT = '#94a3b8';

export function MapView(props: MapViewProps) {
  return (
    <div className={clsx('relative overflow-hidden rounded-2xl border border-line bg-[#e8edf3]', props.className)}>
      {GOOGLE_KEY ? <GoogleEngine {...props} /> : <LeafletEngine {...props} />}
      {props.pickMode && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-[500] flex justify-center">
          <span className="rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
            Click on the map to set the {props.pickMode === 'pickup' ? 'pickup' : 'delivery'} point
          </span>
        </div>
      )}
      {!GOOGLE_KEY && (
        <span className="pointer-events-none absolute bottom-1 left-1 z-[500] rounded bg-white/85 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
          Development map · OpenStreetMap
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaflet engine
// ---------------------------------------------------------------------------

type LeafletNS = typeof import('leaflet');

const pinHtml = (label: string, color: string) => `<div class="tl-pin" style="background:${color}"><span>${label}</span></div>`;
const truckHtml = (heading: number) =>
  `<div class="tl-truck" style="transform:rotate(${heading}deg)"><svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M12 2 19 21 12 17 5 21z"/></svg></div>`;

function LeafletEngine(p: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const L = useRef<LeafletNS | null>(null);
  const map = useRef<import('leaflet').Map | null>(null);
  const layer = useRef<import('leaflet').LayerGroup | null>(null);
  const live = useRef<import('leaflet').LayerGroup | null>(null);
  const latest = useRef(p);
  latest.current = p;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then((mod) => {
      if (cancelled || !el.current || map.current) return;
      const Lf = (mod as unknown as { default?: LeafletNS }).default ?? (mod as unknown as LeafletNS);
      L.current = Lf;
      const m = Lf.map(el.current, { zoomControl: true, attributionControl: true }).setView([INDIA_CENTER.lat, INDIA_CENTER.lng], 5);
      Lf.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
      layer.current = Lf.layerGroup().addTo(m);
      live.current = Lf.layerGroup().addTo(m);
      m.on('click', (e: import('leaflet').LeafletMouseEvent) => {
        const cur = latest.current;
        if (cur.pickMode && cur.onPick) cur.onPick(cur.pickMode, { lat: e.latlng.lat, lng: e.latlng.lng });
      });
      map.current = m;
      setReady(true);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Static layers: markers + routes (+ fit bounds).
  const routesKey = (p.routes ?? []).map((r) => r.polyline.length).join(',');
  useEffect(() => {
    const Lf = L.current;
    const m = map.current;
    if (!ready || !Lf || !m || !layer.current) return;
    layer.current.clearLayers();
    const bounds: [number, number][] = [];
    (p.routes ?? []).forEach((r, i) => {
      const pts = decodePolyline(r.polyline);
      if (!pts.length) return;
      const selected = i === (p.selectedRoute ?? 0);
      const line = Lf.polyline(pts, { color: selected ? BLUE : ALT, weight: selected ? 5 : 4, opacity: selected ? 0.9 : 0.7 });
      if (!selected && p.onSelectRoute) line.on('click', () => latest.current.onSelectRoute?.(i));
      line.addTo(layer.current!);
      if (selected) bounds.push(...pts);
    });
    if (p.breadcrumb?.length) Lf.polyline(p.breadcrumb.map((b) => [b.lat, b.lng] as [number, number]), { color: '#16a34a', weight: 5, opacity: 0.9 }).addTo(layer.current);
    const addPin = (ll: LL, label: string, color: string, onMove?: (ll: LL) => void) => {
      const mk = Lf.marker([ll.lat, ll.lng], { draggable: Boolean(p.draggable && onMove), icon: Lf.divIcon({ html: pinHtml(label, color), className: '', iconSize: [30, 30], iconAnchor: [4, 30] }) });
      if (onMove) mk.on('dragend', () => {
        const pos = mk.getLatLng();
        onMove({ lat: pos.lat, lng: pos.lng });
      });
      mk.addTo(layer.current!);
      bounds.push([ll.lat, ll.lng]);
    };
    if (p.pickup) addPin(p.pickup, 'A', '#16a34a', p.onPickupMove);
    if (p.delivery) addPin(p.delivery, 'B', '#dc2626', p.onDeliveryMove);
    if (bounds.length >= 2) m.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    else if (bounds.length === 1) m.setView(bounds[0], 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, p.pickup?.lat, p.pickup?.lng, p.delivery?.lat, p.delivery?.lng, routesKey, p.selectedRoute, p.draggable, p.breadcrumb?.length, p.fitKey]);

  const markersKey = (p.markers ?? []).map((v) => `${v.id}:${v.lat}:${v.lng}`).join('|');
  // Live vehicle marker (does not refit the map).
  useEffect(() => {
    const Lf = L.current;
    if (!ready || !Lf || !live.current) return;
    live.current.clearLayers();
    if (p.vehicle) {
      Lf.marker([p.vehicle.lat, p.vehicle.lng], { icon: Lf.divIcon({ html: truckHtml(p.vehicle.heading ?? 0), className: '', iconSize: [34, 34], iconAnchor: [17, 17] }), zIndexOffset: 1000 }).addTo(live.current);
    }
    for (const v of p.markers ?? []) {
      Lf.marker([v.lat, v.lng], { icon: Lf.divIcon({ html: truckHtml(0), className: '', iconSize: [34, 34], iconAnchor: [17, 17] }) }).on('click', () => latest.current.onMarker?.(v.id)).addTo(live.current);
    }
  }, [ready, p.vehicle?.lat, p.vehicle?.lng, p.vehicle?.heading, markersKey]);

  useEffect(() => {
    if (el.current) el.current.style.cursor = p.pickMode ? 'crosshair' : '';
  }, [p.pickMode]);

  return <div ref={el} className="absolute inset-0" />;
}

// ---------------------------------------------------------------------------
// Google engine
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
let googlePromise: Promise<any> | null = null;
function loadGoogle(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  const w = window as any;
  if (w.google?.maps) return Promise.resolve(w.google);
  googlePromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_KEY!)}&v=weekly&region=IN`;
    s.async = true;
    s.onload = () => resolve(w.google);
    s.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(s);
  });
  return googlePromise;
}

function GoogleEngine(p: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const g = useRef<any>(null);
  const map = useRef<any>(null);
  const shapes = useRef<any[]>([]);
  const vehicle = useRef<any>(null);
  const fleet = useRef<any[]>([]);
  const latest = useRef(p);
  latest.current = p;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    loadGoogle()
      .then((google) => {
        if (!el.current || map.current) return;
        g.current = google;
        map.current = new google.maps.Map(el.current, { center: INDIA_CENTER, zoom: 5, mapTypeControl: false, streetViewControl: false, fullscreenControl: true });
        map.current.addListener('click', (e: any) => {
          const cur = latest.current;
          if (cur.pickMode && cur.onPick) cur.onPick(cur.pickMode, { lat: e.latLng.lat(), lng: e.latLng.lng() });
        });
        setReady(true);
      })
      .catch(() => setFailed(true));
  }, []);

  const routesKey = (p.routes ?? []).map((r) => r.polyline.length).join(',');
  useEffect(() => {
    const google = g.current;
    if (!ready || !google) return;
    shapes.current.forEach((s) => s.setMap(null));
    shapes.current = [];
    const bounds = new google.maps.LatLngBounds();
    let n = 0;
    (p.routes ?? []).forEach((r, i) => {
      const path = decodePolyline(r.polyline).map(([lat, lng]) => ({ lat, lng }));
      const selected = i === (p.selectedRoute ?? 0);
      const line = new google.maps.Polyline({ path, strokeColor: selected ? BLUE : ALT, strokeWeight: selected ? 5 : 4, strokeOpacity: 0.9, zIndex: selected ? 2 : 1, map: map.current });
      if (!selected && p.onSelectRoute) line.addListener('click', () => latest.current.onSelectRoute?.(i));
      shapes.current.push(line);
      if (selected) path.forEach((pt) => (bounds.extend(pt), n++));
    });
    if (p.breadcrumb?.length) shapes.current.push(new google.maps.Polyline({ path: p.breadcrumb, strokeColor: '#16a34a', strokeWeight: 5, map: map.current, zIndex: 3 }));
    const pin = (ll: LL, label: string, onMove?: (ll: LL) => void) => {
      const mk = new google.maps.Marker({ position: ll, label: { text: label, color: '#fff', fontWeight: '700' }, draggable: Boolean(p.draggable && onMove), map: map.current });
      if (onMove) mk.addListener('dragend', (e: any) => onMove({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
      shapes.current.push(mk);
      bounds.extend(ll);
      n++;
    };
    if (p.pickup) pin(p.pickup, 'A', p.onPickupMove);
    if (p.delivery) pin(p.delivery, 'B', p.onDeliveryMove);
    if (n >= 2) map.current.fitBounds(bounds, 48);
    else if (n === 1) {
      map.current.setCenter(bounds.getCenter());
      map.current.setZoom(12);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, p.pickup?.lat, p.pickup?.lng, p.delivery?.lat, p.delivery?.lng, routesKey, p.selectedRoute, p.draggable, p.breadcrumb?.length, p.fitKey]);

  useEffect(() => {
    const google = g.current;
    if (!ready || !google) return;
    vehicle.current?.setMap(null);
    vehicle.current = p.vehicle
      ? new google.maps.Marker({
          position: p.vehicle,
          zIndex: 10,
          icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 6, rotation: p.vehicle.heading ?? 0, fillColor: '#0b1b3f', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
          map: map.current,
        })
      : null;
    fleet.current.forEach((x) => x.setMap(null));
    fleet.current = (p.markers ?? []).map((v) => {
      const mk = new google.maps.Marker({ position: { lat: v.lat, lng: v.lng }, zIndex: 9, icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 5, fillColor: '#2563eb', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 }, map: map.current });
      mk.addListener('click', () => latest.current.onMarker?.(v.id));
      return mk;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, p.vehicle?.lat, p.vehicle?.lng, p.vehicle?.heading, (p.markers ?? []).map((v) => `${v.id}:${v.lat}:${v.lng}`).join('|')]);

  if (failed) return <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">Google Maps could not be loaded. Check the browser key and its allowed referrers.</div>;
  return <div ref={el} className="absolute inset-0" />;
}
