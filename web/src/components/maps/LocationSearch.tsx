'use client';

import clsx from 'clsx';
import { Bookmark, Crosshair, Loader2, MapPin, Search, Star, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { api, parseApiError } from '@/lib/api';
import type { LocationValue, Place, SavedLocation } from '@/lib/company-types';
import { LOCATION_TYPES } from '@/lib/status';

interface Suggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string;
  location?: Place;
}

const sessionToken = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()));

export function placeToValue(p: Place, extra: Partial<LocationValue> = {}): LocationValue {
  return {
    address: p.address,
    placeId: p.placeId ?? undefined,
    latitude: p.latitude,
    longitude: p.longitude,
    city: p.city ?? undefined,
    state: p.state ?? undefined,
    pincode: p.pincode ?? undefined,
    ...extra,
  };
}

export function savedToValue(s: SavedLocation): LocationValue {
  return {
    address: s.address,
    placeId: s.placeId ?? undefined,
    latitude: s.latitude,
    longitude: s.longitude,
    city: s.city ?? undefined,
    state: s.state ?? undefined,
    pincode: s.pincode ?? undefined,
    savedLocationId: s.id,
    label: s.name,
  };
}

/**
 * Address search: saved locations first, then Google Places Autocomplete (proxied by the backend so the
 * server key stays private). Selecting a result resolves exact coordinates.
 */
export function LocationSearch({
  label,
  value,
  onChange,
  saved = [],
  onPickOnMap,
  picking,
  error,
  marker,
}: {
  label: string;
  value: LocationValue | null;
  onChange: (v: LocationValue | null) => void;
  saved?: SavedLocation[];
  onPickOnMap?: () => void;
  picking?: boolean;
  error?: string;
  marker: 'A' | 'B';
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const token = useRef(sessionToken());
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/maps/places', { params: { q, sessionToken: token.current } });
        setSuggestions(data.data.suggestions);
        setSearchError(null);
      } catch (e) {
        setSearchError(parseApiError(e).message);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const q = query.trim().toLowerCase();
  const savedMatches = saved.filter((s) => !q || s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q) || (s.city ?? '').toLowerCase().includes(q)).slice(0, 5);

  async function choose(s: Suggestion) {
    setOpen(false);
    setQuery('');
    if (s.location) return onChange(placeToValue(s.location));
    try {
      setLoading(true);
      const { data } = await api.get('/maps/places/details', { params: { placeId: s.placeId, sessionToken: token.current } });
      onChange(placeToValue(data.data.place));
      token.current = sessionToken(); // a session ends with a details call
    } catch (e) {
      setSearchError(parseApiError(e).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1.5" ref={box}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        <span className="ml-0.5 text-danger">*</span>
      </label>
      {value ? (
        <div className={clsx('flex items-start gap-3 rounded-[var(--radius-field)] border bg-white p-3', error ? 'border-danger' : 'border-line')}>
          <span className={clsx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white', marker === 'A' ? 'bg-green-600' : 'bg-red-600')}>{marker}</span>
          <div className="min-w-0 flex-1 text-sm">
            {value.label && <p className="font-semibold text-ink">{value.label}</p>}
            <p className={clsx(value.label ? 'text-muted' : 'font-medium text-ink')}>{value.address}</p>
            <p className="mt-0.5 text-xs text-muted">
              {[value.city, value.state, value.pincode].filter(Boolean).join(', ')} · {value.latitude.toFixed(5)}, {value.longitude.toFixed(5)}
            </p>
          </div>
          <button type="button" onClick={() => onChange(null)} className="rounded-lg p-1 text-muted hover:bg-canvas hover:text-ink" aria-label={`Clear ${label.toLowerCase()}`}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            id={id}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search address, plant, depot or city"
            autoComplete="off"
            aria-invalid={Boolean(error) || undefined}
            className={clsx('block h-11 w-full rounded-[var(--radius-field)] border bg-white pl-9 pr-9 text-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100', error ? 'border-danger' : 'border-line')}
          />
          {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" aria-hidden />}
          {open && (savedMatches.length > 0 || suggestions.length > 0 || searchError || q.length >= 3) && (
            <ul className="absolute z-[600] mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-line bg-white py-1 shadow-xl" role="listbox">
              {savedMatches.length > 0 && <li className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Saved locations</li>}
              {savedMatches.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      setQuery('');
                      onChange(savedToValue(s));
                    }}
                    className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-canvas"
                  >
                    <Bookmark className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        {s.name}
                        {(s.isDefaultPickup || s.isDefaultDelivery) && <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-label="Default" />}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {LOCATION_TYPES[s.type]} · {s.address}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {suggestions.length > 0 && <li className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Map results</li>}
              {suggestions.map((s) => (
                <li key={s.placeId}>
                  <button type="button" onClick={() => choose(s)} className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-canvas">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{s.primaryText}</span>
                      <span className="block truncate text-xs text-muted">{s.secondaryText}</span>
                    </span>
                  </button>
                </li>
              ))}
              {searchError && <li className="px-3 py-2 text-xs text-danger">{searchError}</li>}
              {!loading && !searchError && q.length >= 3 && suggestions.length === 0 && savedMatches.length === 0 && <li className="px-3 py-2 text-sm text-muted">No matches. Try a nearby landmark or pick on the map.</li>}
            </ul>
          )}
        </div>
      )}
      {error && <p className="text-xs font-medium text-danger">{error}</p>}
      {onPickOnMap && (
        <button type="button" onClick={onPickOnMap} className={clsx('inline-flex items-center gap-1.5 text-xs font-semibold', picking ? 'text-orange-600' : 'text-brand-600 hover:text-brand-700')}>
          <Crosshair className="h-3.5 w-3.5" aria-hidden />
          {picking ? 'Click the map to place the pin… (click here to cancel)' : value ? 'Adjust on map (or drag the pin)' : 'Select on map'}
        </button>
      )}
    </div>
  );
}
