'use client';

import { useState } from 'react';
import { Checkbox, useToast } from '@/components/ui/kit';
import { Alert, Button, SelectField, TextField } from '@/components/ui/primitives';
import { parseApiError } from '@/lib/api';
import type { Catalog } from '@/lib/company-types';
import { useApi } from '@/lib/useApi';

export type TankerValues = { registrationNumber: string; vehicleMake: string; vehicleModel: string; manufacturingYear: string; capacityKl: string; tankerTypeId: string; compartments: string; compartmentCapacities: string; productIds: string[]; gpsDeviceId: string; availableLocation: string; insuranceExpiry: string; fitnessExpiry: string; permitExpiry: string; pucExpiry: string; pesoLicenceNumber: string; pesoExpiry: string };
export const emptyTanker: TankerValues = { registrationNumber: '', vehicleMake: '', vehicleModel: '', manufacturingYear: '', capacityKl: '', tankerTypeId: '', compartments: '1', compartmentCapacities: '', productIds: [], gpsDeviceId: '', availableLocation: '', insuranceExpiry: '', fitnessExpiry: '', permitExpiry: '', pucExpiry: '', pesoLicenceNumber: '', pesoExpiry: '' };

/** Shared add/edit form. The registration number is fixed after creation. */
export function TankerForm({ initial, onSubmit, editing, submitLabel }: { initial: TankerValues; onSubmit: (payload: Record<string, unknown>) => Promise<void>; editing?: boolean; submitLabel: string }) {
  const toast = useToast();
  const { data: catalog } = useApi<Catalog>('/catalog', { revalidateOnFocus: false });
  const [f, setF] = useState(initial);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [fail, setFail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bind = (k: Exclude<keyof TankerValues, 'productIds'>) => ({ value: f[k], error: fields[k], onChange: (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value })) });
  const go = async () => {
    setBusy(true);
    setFail(null);
    setFields({});
    const caps = f.compartmentCapacities.split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
    const optional = (k: Exclude<keyof TankerValues, 'productIds'>) => (f[k] ? { [k]: f[k] } : {});
    try {
      await onSubmit({
        ...(editing ? {} : { registrationNumber: f.registrationNumber.toUpperCase().replace(/\s/g, '') }),
        vehicleMake: f.vehicleMake, vehicleModel: f.vehicleModel, manufacturingYear: Number(f.manufacturingYear), capacityKl: Number(f.capacityKl), tankerTypeId: f.tankerTypeId, compartments: Number(f.compartments), ...(caps.length ? { compartmentCapacities: caps } : {}), productIds: f.productIds,
        ...optional('gpsDeviceId'), ...optional('availableLocation'), ...optional('insuranceExpiry'), ...optional('fitnessExpiry'), ...optional('permitExpiry'), ...optional('pucExpiry'), ...optional('pesoLicenceNumber'), ...optional('pesoExpiry'),
      });
    } catch (e) {
      const p = parseApiError(e);
      setFail(p.message);
      setFields(Object.fromEntries(p.fields.map((x) => [x.field, x.message])));
      toast.error(p.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      {fail && <Alert tone="error">{fail}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TextField label="Vehicle registration number" required disabled={editing} placeholder="MH12AB1234" {...bind('registrationNumber')} />
        <TextField label="Vehicle make" required {...bind('vehicleMake')} /><TextField label="Vehicle model" required {...bind('vehicleModel')} /><TextField label="Manufacturing year" required type="number" {...bind('manufacturingYear')} />
        <TextField label="Tanker capacity (KL)" required type="number" {...bind('capacityKl')} />
        <SelectField label="Tanker type" required {...bind('tankerTypeId')}><option value="">Select…</option>{catalog?.tankerTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectField>
        <TextField label="Number of compartments" required type="number" min={1} {...bind('compartments')} />
        <TextField label="Compartment capacities (KL)" hint="Comma separated, e.g. 12, 8. Must add up to capacity." {...bind('compartmentCapacities')} />
        <TextField label="GPS device ID" {...bind('gpsDeviceId')} /><TextField label="Current operating location" {...bind('availableLocation')} />
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-ink">Permitted product categories</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{catalog?.products.map((p) => <Checkbox key={p.id} label={p.name} checked={f.productIds.includes(p.id)} onChange={() => setF((v) => ({ ...v, productIds: v.productIds.includes(p.id) ? v.productIds.filter((x) => x !== p.id) : [...v.productIds, p.id] }))} />)}</div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TextField label="Insurance expiry" type="date" {...bind('insuranceExpiry')} /><TextField label="Fitness expiry" type="date" {...bind('fitnessExpiry')} /><TextField label="Permit expiry" type="date" {...bind('permitExpiry')} /><TextField label="PUC expiry" type="date" {...bind('pucExpiry')} /><TextField label="PESO licence number" {...bind('pesoLicenceNumber')} /><TextField label="PESO expiry" type="date" {...bind('pesoExpiry')} />
      </div>
      <Button loading={busy} disabled={busy || !f.tankerTypeId || f.productIds.length === 0} onClick={() => void go()}>{submitLabel}</Button>
    </div>
  );
}
