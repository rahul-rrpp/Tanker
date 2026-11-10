'use client';

import clsx from 'clsx';
import { Check, Download, Eye, Upload } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Modal, Spinner, TextArea, useToast } from '@/components/ui/kit';
import { Button, SelectField, TextField } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateTimeIST, inr, humanize } from '@/lib/format';
import { TRIP_STATUS } from '@/lib/status';
import { TRIP_FLOW } from '@/lib/transporter';

export type Column<T> = { key: string; label: string; render: (row: T) => ReactNode; className?: string };

export function DataTable<T>({ columns, rows, rowKey }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-white">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
          <tr>{columns.map((c) => <th key={c.key} scope="col" className={clsx('whitespace-nowrap px-4 py-3 font-medium', c.className)}>{c.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => <tr key={rowKey(r)} className="hover:bg-canvas/60">{columns.map((c) => <td key={c.key} className={clsx('px-4 py-3 align-top text-ink', c.className)}>{c.render(r)}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

/** Button that runs one API action, shows progress and reports the result. */
export function ActionButton({ action, success, onDone, confirm, children, variant = 'secondary', size = 'sm', className, disabled }: { action: () => Promise<unknown>; success: string; onDone?: () => void; confirm?: string; children: ReactNode; variant?: 'primary' | 'secondary' | 'danger'; size?: 'sm' | 'md'; className?: string; disabled?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      onDone?.();
      setAsking(false);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant={variant} size={size} className={className} disabled={busy || disabled} onClick={() => (confirm ? setAsking(true) : void run())}>
        {busy && <Spinner />} {children}
      </Button>
      {confirm && (
        <Modal open={asking} onClose={() => setAsking(false)} title="Please confirm" footer={<><Button variant="secondary" onClick={() => setAsking(false)}>Go back</Button><Button variant={variant === 'danger' ? 'danger' : 'primary'} onClick={() => void run()} disabled={busy}>{busy && <Spinner />} Confirm</Button></>}>
          <p className="text-sm text-ink">{confirm}</p>
        </Modal>
      )}
    </>
  );
}

/** Upload with a type picker (and optional expiry). The server re-checks the real file type. */
export function DocumentUpload({ endpoint, types, onDone, fieldName = 'docType', expiry = false, label = 'Upload document' }: { endpoint: string; types: Record<string, string>; onDone: () => void; fieldName?: string; expiry?: boolean; label?: string }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [type, setType] = useState(Object.keys(types)[0]);
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (file: File) => {
    const form = new FormData();
    form.append(fieldName, type);
    if (expiry && date) form.append('expiryDate', date);
    form.append('file', file);
    setBusy(true);
    try {
      await api.post(endpoint, form);
      toast.success('Document uploaded');
      setDate('');
      onDone();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed border-line p-4 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1">
        <SelectField label="Document type" value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </SelectField>
      </div>
      {expiry && <div className="sm:w-44"><TextField label="Expiry (if any)" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>}
      <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && void send(e.target.files[0])} />
      <Button variant="secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? <Spinner /> : <Upload className="h-4 w-4" aria-hidden />} {label}</Button>
    </div>
  );
}

/** Authenticated file links. Cookies go with same-origin GETs through the /api/v1 proxy. */
export function FileLinks({ path }: { path: string }) {
  const href = `/api/v1${path}`;
  const sep = href.includes('?') ? '&' : '?';
  return (
    <span className="inline-flex gap-1">
      <a href={`${href}${sep}inline=1`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-brand-50"><Eye className="h-3.5 w-3.5" aria-hidden /> Preview</a>
      <a href={href} download className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-brand-50"><Download className="h-3.5 w-3.5" aria-hidden /> Download</a>
    </span>
  );
}

export function NegotiationTimeline({ items }: { items: { id: string; party: string; action: string; amount: number | null; message: string | null; createdAt: string }[] }) {
  return (
    <ol className="space-y-3">
      {items.map((h) => {
        const me = h.party === 'TRANSPORTER';
        const system = h.party === 'SYSTEM';
        return (
          <li key={h.id} className={clsx('flex', system ? 'justify-center' : me ? 'justify-end' : 'justify-start')}>
            <div className={clsx('max-w-[85%] rounded-2xl px-4 py-2.5 text-sm', system ? 'bg-slate-100 text-muted' : me ? 'bg-brand-600 text-white' : 'border border-line bg-white text-ink')}>
              <p className="text-xs font-medium opacity-80">{system ? 'System' : me ? 'You' : 'Company'} · {humanize(h.action)}</p>
              {h.amount !== null && <p className="text-lg font-bold tabular-nums">{inr(h.amount)}</p>}
              {h.message && <p className="mt-0.5">{h.message}</p>}
              <p className="mt-1 text-[11px] opacity-70">{dateTimeIST(h.createdAt)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function TripTimeline({ status, history }: { status: string; history: { newStatus: string; at: string; updatedBy?: string; remarks?: string | null }[] }) {
  const current = TRIP_FLOW.indexOf(status);
  const when = (s: string) => [...history].reverse().find((h) => h.newStatus === s);
  return (
    <ol>
      {TRIP_FLOW.map((s, i) => {
        const done = i < current || status === 'COMPLETED';
        const now = i === current && status !== 'COMPLETED';
        const h = when(s);
        return (
          <li key={s} className="relative flex gap-3 pb-4 last:pb-0">
            {i < TRIP_FLOW.length - 1 && <span className={clsx('absolute left-[11px] top-6 h-[calc(100%-12px)] w-0.5', done ? 'bg-green-500' : 'bg-line')} aria-hidden />}
            <span className={clsx('relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold', done ? 'border-green-600 bg-green-600 text-white' : now ? 'border-brand-600 bg-white text-brand-700 ring-4 ring-brand-100' : 'border-line bg-white text-muted')}>{done ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
            <div className="-mt-0.5 min-w-0">
              <p className={clsx('text-sm font-medium', done || now ? 'text-ink' : 'text-muted')}>{TRIP_STATUS[s]?.label ?? s}</p>
              {h && <p className="text-xs text-muted">{dateTimeIST(h.at)}{h.updatedBy ? ` · ${h.updatedBy}` : ''}{h.remarks ? ` · ${h.remarks}` : ''}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Reusable one-field prompt for reasons, notes and amounts. */
export function PromptModal({ open, onClose, title, label, submit, onSubmit, multiline, type = 'text', hint }: { open: boolean; onClose: () => void; title: string; label: string; submit: string; onSubmit: (value: string) => Promise<void>; multiline?: boolean; type?: string; hint?: ReactNode }) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await onSubmit(value);
      setValue('');
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !value.trim()} onClick={() => void go()}>{busy && <Spinner />} {submit}</Button></>}>
      {multiline ? <TextArea label={label} value={value} onChange={(e) => setValue(e.target.value)} hint={hint} /> : <TextField label={label} type={type} value={value} onChange={(e) => setValue(e.target.value)} hint={hint} />}
    </Modal>
  );
}
