'use client';

import { useState } from 'react';
import { Alert, Button, SelectField, TextField } from '@/components/ui/primitives';
import { parseApiError } from '@/lib/api';

export type DriverValues = { fullName: string; phone: string; email: string; address: string; licenceNumber: string; licenceType: string; licenceExpiry: string; hazardousTraining: string; hazardousTrainingExpiry: string; emergencyContactName: string; emergencyContactPhone: string; employmentStatus: string };
export const emptyDriver: DriverValues = { fullName: '', phone: '', email: '', address: '', licenceNumber: '', licenceType: 'HGMV', licenceExpiry: '', hazardousTraining: 'NOT_PROVIDED', hazardousTrainingExpiry: '', emergencyContactName: '', emergencyContactPhone: '', employmentStatus: 'ACTIVE' };

/** Add / edit. Mobile and licence number identify the person and are fixed after creation. */
export function DriverForm({ initial, editing, onSubmit, submitLabel }: { initial: DriverValues; editing?: boolean; onSubmit: (body: Record<string, unknown>) => Promise<void>; submitLabel: string }) {
  const [f, setF] = useState(initial);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [fail, setFail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bind = (k: keyof DriverValues) => ({ value: f[k], error: fields[k], onChange: (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value })) });
  const go = async () => {
    setBusy(true);
    setFail(null);
    setFields({});
    const { phone, licenceNumber, hazardousTrainingExpiry, ...rest } = f;
    try {
      await onSubmit({ ...rest, ...(editing ? {} : { phone, licenceNumber }), ...(hazardousTrainingExpiry ? { hazardousTrainingExpiry } : {}) });
    } catch (e) {
      const p = parseApiError(e);
      setFail(p.message);
      setFields(Object.fromEntries(p.fields.map((x) => [x.field, x.message])));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      {fail && <Alert tone="error">{fail}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TextField label="Driver name" required {...bind('fullName')} />
        <TextField label="Mobile number" required disabled={editing} inputMode="numeric" maxLength={10} {...bind('phone')} />
        <TextField label="Email (optional)" type="email" {...bind('email')} />
        <TextField label="Address" required {...bind('address')} />
        <TextField label="Driving licence number" required disabled={editing} {...bind('licenceNumber')} />
        <SelectField label="Licence type" {...bind('licenceType')}>{['HMV', 'HGMV', 'HTV', 'TRANS', 'LMV'].map((t) => <option key={t}>{t}</option>)}</SelectField>
        <TextField label="Licence expiry" required type="date" {...bind('licenceExpiry')} />
        <SelectField label="Hazardous goods training" {...bind('hazardousTraining')}><option value="NOT_PROVIDED">Not provided</option><option value="PENDING">Pending</option><option value="VALID">Valid</option><option value="EXPIRED">Expired</option><option value="NOT_REQUIRED">Not required</option></SelectField>
        <TextField label="Training expiry" type="date" {...bind('hazardousTrainingExpiry')} />
        <TextField label="Emergency contact name" required {...bind('emergencyContactName')} />
        <TextField label="Emergency contact mobile" required inputMode="numeric" maxLength={10} {...bind('emergencyContactPhone')} />
        <SelectField label="Employment status" {...bind('employmentStatus')}><option value="ACTIVE">Active</option><option value="ON_LEAVE">On leave</option><option value="RESIGNED">Resigned</option><option value="TERMINATED">Terminated</option></SelectField>
      </div>
      <Button loading={busy} disabled={busy} onClick={() => void go()}>{submitLabel}</Button>
    </div>
  );
}
