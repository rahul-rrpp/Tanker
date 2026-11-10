'use client';

import { useEffect, useState } from 'react';
import { Modal, useToast } from '@/components/ui/kit';
import { Button, SelectField, TextField } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';
import type { LocationValue, SavedLocation } from '@/lib/company-types';
import { LOCATION_TYPES } from '@/lib/status';

/** Saves a picked location to the company's Saved Locations. */
export function SaveLocationDialog({
  open,
  onClose,
  location,
  defaultType,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  location: LocationValue | null;
  defaultType: string;
  onSaved: (s: SavedLocation) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [type, setType] = useState(defaultType);
  const [contactPerson, setContactPerson] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setName(location?.city ? `${location.city} site` : '');
      setType(defaultType);
      setErrors({});
    }
  }, [open, location, defaultType]);

  async function save() {
    if (!location) return;
    setSaving(true);
    setErrors({});
    try {
      const { data } = await api.post('/locations', {
        name,
        type,
        contactPerson: contactPerson || undefined,
        contactPhone: contactPhone || undefined,
        address: location.address,
        placeId: location.placeId,
        latitude: location.latitude,
        longitude: location.longitude,
        city: location.city,
        state: location.state,
        pincode: location.pincode,
      });
      toast.success(`Saved "${name}"`);
      onSaved(data.data.location);
      onClose();
    } catch (e) {
      const err = parseApiError(e);
      setErrors(Object.fromEntries(err.fields.map((f) => [f.field, f.message])));
      if (!err.fields.length) toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Save location"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={name.trim().length < 2}>
            Save location
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg bg-canvas p-3 text-sm text-muted">{location?.address}</p>
        <TextField label="Location name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} required placeholder="e.g. Chakan plant" />
        <SelectField label="Location type" value={type} onChange={(e) => setType(e.target.value)} options={Object.entries(LOCATION_TYPES).map(([value, label]) => ({ value, label }))} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Contact person" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} error={errors.contactPerson} />
          <TextField label="Contact number" inputMode="numeric" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} error={errors.contactPhone} />
        </div>
      </div>
    </Modal>
  );
}
