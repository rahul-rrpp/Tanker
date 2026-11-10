'use client';

import { Map as MapIcon, MapPin, Pencil, Plus, Search, Star, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LocationSearch } from '@/components/maps/LocationSearch';
import { MapView } from '@/components/maps/MapView';
import { EmptyState, ErrorBlock, LoadingBlock, Modal, PageHeader, useToast } from '@/components/ui/kit';
import { Alert, Button, Card, SelectField, TextField } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';
import type { LocationValue, SavedLocation } from '@/lib/company-types';
import { LOCATION_TYPES } from '@/lib/status';
import { useApi } from '@/lib/useApi';

const blank = { name: '', type: 'FACTORY', contactPerson: '', contactPhone: '', isDefaultPickup: false, isDefaultDelivery: false };

function LocationEditor({ open, onClose, editing, onSaved }: { open: boolean; onClose: () => void; editing: SavedLocation | null; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState(blank);
  const [loc, setLoc] = useState<LocationValue | null>(null);
  const [pick, setPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setError(null);
    setPick(false);
    if (editing) {
      setF({ name: editing.name, type: editing.type, contactPerson: editing.contactPerson ?? '', contactPhone: editing.contactPhone ?? '', isDefaultPickup: editing.isDefaultPickup, isDefaultDelivery: editing.isDefaultDelivery });
      setLoc({ address: editing.address, latitude: editing.latitude, longitude: editing.longitude, city: editing.city ?? undefined, state: editing.state ?? undefined, pincode: editing.pincode ?? undefined, placeId: editing.placeId ?? undefined });
    } else {
      setF(blank);
      setLoc(null);
    }
  }, [open, editing]);

  async function reverse(lat: number, lng: number) {
    try {
      const { data } = await api.get('/maps/reverse', { params: { lat, lng } });
      const p = data.data.place;
      setLoc({ address: p.address, latitude: lat, longitude: lng, city: p.city ?? undefined, state: p.state ?? undefined, pincode: p.pincode ?? undefined, placeId: p.placeId ?? undefined });
    } catch (e) {
      toast.error(e);
    }
  }

  async function save() {
    if (!loc) return setErrors({ address: 'Search or pick the location on the map' });
    setBusy(true);
    setError(null);
    try {
      const body = { ...f, contactPerson: f.contactPerson || undefined, contactPhone: f.contactPhone || undefined, address: loc.address, placeId: loc.placeId, latitude: loc.latitude, longitude: loc.longitude, city: loc.city, state: loc.state, pincode: loc.pincode };
      if (editing) await api.put(`/locations/${editing.id}`, body);
      else await api.post('/locations', body);
      toast.success(editing ? 'Location updated' : 'Location saved');
      onSaved();
      onClose();
    } catch (e) {
      const err = parseApiError(e);
      setError(err.message);
      setErrors(Object.fromEntries(err.fields.map((x) => [x.field, x.message])));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${editing.name}` : 'Add location'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            {editing ? 'Save changes' : 'Save location'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Location name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errors.name} required placeholder="e.g. Chakan plant" />
          <SelectField label="Location type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={Object.entries(LOCATION_TYPES).map(([value, label]) => ({ value, label }))} />
          <TextField label="Contact person" value={f.contactPerson} onChange={(e) => setF({ ...f, contactPerson: e.target.value })} error={errors.contactPerson} />
          <TextField label="Contact number" inputMode="numeric" value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} error={errors.contactPhone} />
        </div>
        <LocationSearch label="Address (Google Maps location)" marker="A" value={loc} onChange={setLoc} picking={pick} onPickOnMap={() => setPick((p) => !p)} error={errors.address} />
        <MapView
          className="h-56"
          pickup={loc ? { lat: loc.latitude, lng: loc.longitude } : null}
          draggable
          onPickupMove={(ll) => void reverse(ll.lat, ll.lng)}
          pickMode={pick ? 'pickup' : null}
          onPick={(_, ll) => {
            setPick(false);
            void reverse(ll.lat, ll.lng);
          }}
        />
        {loc && (
          <div className="grid grid-cols-2 gap-3 text-xs text-muted sm:grid-cols-4">
            <span>Lat {loc.latitude.toFixed(6)}</span>
            <span>Lng {loc.longitude.toFixed(6)}</span>
            <span>{loc.city ?? '—'}, {loc.state ?? '—'}</span>
            <span>PIN {loc.pincode ?? '—'}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.isDefaultPickup} onChange={(e) => setF({ ...f, isDefaultPickup: e.target.checked })} className="h-4 w-4 accent-brand-600" /> Default pickup location
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.isDefaultDelivery} onChange={(e) => setF({ ...f, isDefaultDelivery: e.target.checked })} className="h-4 w-4 accent-brand-600" /> Default delivery location
          </label>
        </div>
      </div>
    </Modal>
  );
}

export default function LocationsPage() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [type, setType] = useState('');
  const [editor, setEditor] = useState<{ open: boolean; editing: SavedLocation | null }>({ open: false, editing: null });
  const [deleting, setDeleting] = useState<SavedLocation | null>(null);
  const [viewing, setViewing] = useState<SavedLocation | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const qs = new URLSearchParams({ ...(debounced ? { q: debounced } : {}), ...(type ? { type } : {}) });
  const { data, error, isLoading, mutate } = useApi<{ locations: SavedLocation[] }>(`/locations?${qs}`);

  async function setDefault(l: SavedLocation, kind: 'pickup' | 'delivery') {
    const value = kind === 'pickup' ? !l.isDefaultPickup : !l.isDefaultDelivery;
    try {
      await api.post(`/locations/${l.id}/default`, { kind, value });
      toast.success(value ? `${l.name} is now the default ${kind} location` : `Default ${kind} cleared`);
      void mutate();
    } catch (e) {
      toast.error(e);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/locations/${deleting.id}`);
      toast.success(`${deleting.name} deleted`);
      setDeleting(null);
      void mutate();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Saved Locations"
        subtitle="Factories, depots and delivery points you book from often. Pick them in one tap when booking."
        actions={
          <Button onClick={() => setEditor({ open: true, editing: null })}>
            <Plus className="h-4 w-4" /> Add location
          </Button>
        }
      />
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search saved locations" aria-label="Search saved locations" className="h-11 w-full rounded-[var(--radius-field)] border border-line bg-white pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100" />
        </div>
        <div className="sm:w-56">
          <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value)} options={[{ value: '', label: 'All types' }, ...Object.entries(LOCATION_TYPES).map(([value, label]) => ({ value, label }))]} />
        </div>
      </div>
      {error ? (
        <ErrorBlock error={error} onRetry={() => mutate()} />
      ) : isLoading || !data ? (
        <LoadingBlock />
      ) : data.locations.length === 0 ? (
        <EmptyState title={debounced || type ? 'No matching locations' : 'No saved locations yet'} icon={<MapPin className="h-6 w-6" />} action={<Button onClick={() => setEditor({ open: true, editing: null })}>Add your first location</Button>}>
          Save your factory, depots and regular delivery points to book faster.
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.locations.map((l) => (
            <Card key={l.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{l.name}</p>
                  <p className="text-xs font-medium text-brand-700">{LOCATION_TYPES[l.type]}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setViewing(l)} className="rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-ink" aria-label={`View ${l.name} on map`} title="View on map">
                    <MapIcon className="h-4 w-4" />
                  </button>
                  <button onClick={() => setEditor({ open: true, editing: l })} className="rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-ink" aria-label={`Edit ${l.name}`}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => setDeleting(l)} className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-danger" aria-label={`Delete ${l.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="mt-2 flex-1 text-sm text-muted">{l.address}</p>
              <p className="mt-1 text-xs text-muted">
                {[l.city, l.state, l.pincode].filter(Boolean).join(', ')} · {l.latitude.toFixed(4)}, {l.longitude.toFixed(4)}
              </p>
              {l.contactPerson && (
                <p className="mt-1 text-xs text-muted">
                  {l.contactPerson} {l.contactPhone && `· ${l.contactPhone}`}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                {(['pickup', 'delivery'] as const).map((k) => {
                  const on = k === 'pickup' ? l.isDefaultPickup : l.isDefaultDelivery;
                  return (
                    <button key={k} onClick={() => setDefault(l, k)} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${on ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-line text-muted hover:text-ink'}`}>
                      <Star className={`h-3.5 w-3.5 ${on ? 'fill-amber-400 text-amber-400' : ''}`} /> {on ? `Default ${k}` : `Set default ${k}`}
                    </button>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={Boolean(viewing)} onClose={() => setViewing(null)} title={viewing?.name ?? 'Location'} size="lg">
        {viewing && (
          <div className="space-y-3">
            <MapView className="h-80" pickup={{ lat: viewing.latitude, lng: viewing.longitude }} fitKey={viewing.id} />
            <p className="text-sm text-ink">{viewing.address}</p>
            <p className="text-xs text-muted">
              {LOCATION_TYPES[viewing.type]} · {viewing.latitude.toFixed(6)}, {viewing.longitude.toFixed(6)} · {[viewing.city, viewing.state, viewing.pincode].filter(Boolean).join(', ')}
            </p>
            <a href={`https://www.google.com/maps/search/?api=1&query=${viewing.latitude},${viewing.longitude}`} target="_blank" rel="noopener noreferrer" className="inline-flex text-sm font-semibold text-brand-600 hover:text-brand-700">
              Open in Google Maps ↗
            </a>
          </div>
        )}
      </Modal>
      <LocationEditor open={editor.open} editing={editor.editing} onClose={() => setEditor({ open: false, editing: null })} onSaved={() => mutate()} />
      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove} loading={busy}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">Past bookings keep their addresses. This only removes the location from your saved list.</p>
      </Modal>
    </div>
  );
}
