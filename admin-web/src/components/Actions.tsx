'use client';

import { useEffect, useState } from 'react';
import type { ActionDef, FieldDef, Option, Rec } from '@/config/types';
import { api, fetcher, parseApiError } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useCan } from './Shell';
import { Alert, Button, Input, Modal, Select, Textarea, useToast } from './ui';

const toOption = (o: string | Option): Option => (typeof o === 'string' ? { value: o, label: humanize(o) } : o);

function initialValue(f: FieldDef, record: Rec): string | boolean {
  const v = f.initial?.(record);
  if (f.type === 'checkbox') return Boolean(v);
  if (v === null || v === undefined) return '';
  if (f.type === 'lines' && Array.isArray(v)) return v.join('\n');
  if (f.type === 'numberList' && Array.isArray(v)) return v.join(', ');
  if (f.type === 'date' && typeof v === 'string') return v.slice(0, 10);
  return String(v);
}

/** Converts form strings to the JSON the API expects; empty optional fields are omitted (or null). */
export function toBody(fields: FieldDef[], values: Rec): Rec {
  const out: Rec = {};
  for (const f of fields) {
    const v = values[f.name];
    if (f.type === 'checkbox') { out[f.name] = Boolean(v); continue; }
    if (v === '' || v === undefined) { if (f.nullable) out[f.name] = null; continue; }
    if (f.type === 'number') out[f.name] = Number(v);
    else if (f.type === 'lines') out[f.name] = String(v).split('\n').map((s) => s.trim()).filter(Boolean);
    else if (f.type === 'numberList') out[f.name] = String(v).split(',').map((s) => s.trim()).filter(Boolean).map(Number);
    else if (f.type === 'datetime') out[f.name] = new Date(String(v)).toISOString();
    else out[f.name] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

function OptionsField({ f, value, onChange, error }: { f: FieldDef; value: string; onChange: (v: string) => void; error?: string }) {
  const [loaded, setLoaded] = useState<Option[] | null>(f.optionsFrom ? null : (f.options ?? []).map(toOption));
  useEffect(() => {
    if (!f.optionsFrom) return;
    const src = f.optionsFrom;
    fetcher<Rec>(src.path).then((d) => setLoaded(((d[src.dataKey] as Rec[]) ?? []).map((r) => ({ value: src.value(r), label: src.label(r) })))).catch(() => setLoaded([]));
  }, [f.optionsFrom]);
  return (
    <Select label={f.label} required={f.required} hint={f.hint} error={error} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{loaded ? 'Select…' : 'Loading…'}</option>
      {loaded?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );
}

export function FormFields({ fields, values, setValues, errors }: { fields: FieldDef[]; values: Rec; setValues: (fn: (v: Rec) => Rec) => void; errors: Record<string, string> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => {
        const set = (v: unknown) => setValues((x) => ({ ...x, [f.name]: v }));
        const common = { label: f.label, required: f.required, hint: f.hint, error: errors[f.name] };
        const wide = f.type === 'textarea' || f.type === 'lines';
        if (f.type === 'select') return <OptionsField key={f.name} f={f} value={String(values[f.name] ?? '')} onChange={set} error={errors[f.name]} />;
        if (f.type === 'checkbox') return <label key={f.name} className="flex items-center gap-2 self-end py-2 text-sm"><input type="checkbox" checked={Boolean(values[f.name])} onChange={(e) => set(e.target.checked)} className="h-4 w-4 rounded border-line" />{f.label}</label>;
        if (wide) return <div key={f.name} className="sm:col-span-2"><Textarea {...common} rows={f.type === 'lines' ? 4 : 3} value={String(values[f.name] ?? '')} onChange={(e) => set(e.target.value)} /></div>;
        const type = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'datetime' ? 'datetime-local' : 'text';
        return <Input key={f.name} {...common} type={type} step={f.type === 'number' ? 'any' : undefined} value={String(values[f.name] ?? '')} onChange={(e) => set(e.target.value)} />;
      })}
    </div>
  );
}

/** Runs one ActionDef against a record: a confirmation or a form, then the API call. */
export function ActionButton({ action, record, onDone, size = 'sm' }: { action: ActionDef; record: Rec; onDone?: () => void; size?: 'sm' | 'md' }) {
  const toast = useToast();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Rec>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [fail, setFail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (action.when && !action.when(record)) return null;
  if (action.perm && !can(action.perm)) return null;
  const fields = action.fields ?? [];

  const start = () => {
    setValues(Object.fromEntries(fields.map((f) => [f.name, initialValue(f, record)])));
    setErrors({});
    setFail(null);
    setOpen(true);
  };
  const run = async () => {
    setBusy(true);
    setFail(null);
    setErrors({});
    try {
      const body = action.body ? action.body(toBody(fields, values), record) : toBody(fields, values);
      const method = action.method ?? 'post';
      const r = method === 'delete' ? await api.delete(action.path(record)) : await api[method](action.path(record), body);
      toast.success((r.data as { message?: string })?.message ?? 'Done');
      setOpen(false);
      onDone?.();
    } catch (e) {
      const p = parseApiError(e);
      setFail(p.message);
      setErrors(Object.fromEntries(p.fields.map((x) => [x.field, x.message])));
    } finally {
      setBusy(false);
    }
  };
  const missing = fields.some((f) => f.required && f.type !== 'checkbox' && !String(values[f.name] ?? '').trim());
  const confirmText = typeof action.confirm === 'function' ? action.confirm(record) : action.confirm;
  return (
    <>
      <Button size={size} variant={action.variant ?? 'secondary'} onClick={start}>{action.label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={action.label} wide={fields.length > 6} footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button variant={action.variant === 'danger' ? 'danger' : 'primary'} loading={busy} disabled={missing} onClick={() => void run()}>{fields.length ? 'Save' : 'Confirm'}</Button></>}>
        <div className="space-y-3">
          {fail && <Alert tone="error">{fail}</Alert>}
          {fields.length ? <FormFields fields={fields} values={values} setValues={setValues} errors={errors} /> : <p className="text-sm text-ink">{confirmText ?? `${action.label}?`}</p>}
        </div>
      </Modal>
    </>
  );
}

export function ActionBar({ actions, record, onDone }: { actions?: ActionDef[]; record: Rec; onDone?: () => void }) {
  if (!actions?.length) return null;
  return <>{actions.map((a) => <ActionButton key={a.label} action={a} record={record} onDone={onDone} size="md" />)}</>;
}
