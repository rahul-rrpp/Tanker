'use client';

import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import { createContext, forwardRef, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { parseApiError } from '@/lib/api';
import { humanize, toneFor, type Tone } from '@/lib/format';

// ---- Buttons ---------------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-300',
  secondary: 'border border-line bg-white text-ink hover:bg-canvas disabled:text-muted',
  ghost: 'text-brand-700 hover:bg-brand-50 disabled:text-muted',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }>(function Button(
  { variant = 'primary', size = 'md', loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx('inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed', size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm', VARIANTS[variant], className)}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

// ---- Form fields -------------------------------------------------------------------------------

const fieldClass = 'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-canvas';

export function FieldShell({ label, error, hint, required, children }: { label: string; error?: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-ink">{label}{required && <span className="text-red-600"> *</span>}</span>
      {children}
      {error ? <span className="block text-xs text-red-600">{error}</span> : hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

type Common = { label: string; error?: string; hint?: string };
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Common>(function Input({ label, error, hint, required, className, ...rest }, ref) {
  return <FieldShell label={label} error={error} hint={hint} required={required}><input ref={ref} required={required} className={clsx(fieldClass, className)} {...rest} /></FieldShell>;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & Common>(function Textarea({ label, error, hint, required, className, ...rest }, ref) {
  return <FieldShell label={label} error={error} hint={hint} required={required}><textarea ref={ref} rows={3} required={required} className={clsx(fieldClass, className)} {...rest} /></FieldShell>;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & Common>(function Select({ label, error, hint, required, className, children, ...rest }, ref) {
  return <FieldShell label={label} error={error} hint={hint} required={required}><select ref={ref} required={required} className={clsx(fieldClass, className)} {...rest}>{children}</select></FieldShell>;
});

// ---- Surfaces ----------------------------------------------------------------------------------

export const Card = ({ className, children }: { className?: string; children: ReactNode }) => <div className={clsx('rounded-2xl border border-line bg-white shadow-sm', className)}>{children}</div>;

export function Section({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={clsx('p-5', className)}>
      {(title || actions) && <div className="mb-4 flex flex-wrap items-center justify-between gap-2">{title ? <h2 className="text-base font-semibold text-ink">{title}</h2> : <span />}<div className="flex flex-wrap gap-2">{actions}</div></div>}
      {children}
    </Card>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && <Link href={back.href} className="mb-2 inline-block text-sm font-medium text-brand-600 hover:text-brand-700">← {back.label}</Link>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h1 className="text-2xl font-bold text-ink">{title}</h1>{subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}</div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  info: 'bg-brand-50 text-brand-700',
  success: 'bg-green-50 text-green-700',
  warning: 'bg-orange-50 text-orange-700',
  danger: 'bg-red-50 text-red-700',
};
export const Badge = ({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) => <span className={clsx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', TONES[tone])}>{children}</span>;
export const StatusBadge = ({ value }: { value: string | null | undefined }) => (value ? <Badge tone={toneFor(value)}>{humanize(value)}</Badge> : <span className="text-muted">—</span>);

export function Stat({ label, value, hint, href, tone = 'brand' }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: 'brand' | 'green' | 'orange' | 'red' }) {
  const bar = { brand: 'bg-brand-500', green: 'bg-green-500', orange: 'bg-orange-500', red: 'bg-red-500' }[tone];
  const body = (
    <Card className="relative h-full overflow-hidden p-4 transition-shadow hover:shadow-md">
      <span className={clsx('absolute inset-y-0 left-0 w-1', bar)} />
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Alert({ tone = 'info', title, children }: { tone?: 'info' | 'success' | 'error' | 'warning'; title?: ReactNode; children?: ReactNode }) {
  const style = { info: 'border-brand-200 bg-brand-50 text-brand-900', success: 'border-green-200 bg-green-50 text-green-900', error: 'border-red-200 bg-red-50 text-red-900', warning: 'border-orange-200 bg-orange-50 text-orange-900' }[tone];
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={clsx('flex gap-3 rounded-xl border p-3 text-sm', style)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">{title && <p className="font-semibold">{title}</p>}{children}</div>
    </div>
  );
}

export const Loading = ({ label = 'Loading…' }: { label?: string }) => <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />{label}</div>;
export const Empty = ({ title = 'Nothing here yet', children }: { title?: string; children?: ReactNode }) => <div className="rounded-xl border border-dashed border-line py-10 text-center"><p className="text-sm font-medium text-ink">{title}</p>{children && <div className="mt-1 text-sm text-muted">{children}</div>}</div>;
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = parseApiError(error);
  return <Alert tone="error" title={e.status === 403 ? 'You do not have access to this' : 'Could not load this'}>{e.message}{onRetry && <button onClick={onRetry} className="ml-2 font-semibold underline">Try again</button>}</Alert>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={t.value === value} onClick={() => onChange(t.value)} className={clsx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', t.value === value ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink')}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 rounded-full bg-canvas px-1.5 text-xs">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <p className="mt-3 text-xs text-muted">{total} {total === 1 ? 'record' : 'records'}</p>;
  return (
    <div className="mt-3 flex items-center justify-between text-sm">
      <span className="text-muted">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
      <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</Button><Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</Button></div>
    </div>
  );
}

export function KV({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((i) => <div key={i.label} className="min-w-0"><dt className="text-xs font-medium uppercase tracking-wide text-muted">{i.label}</dt><dd className="mt-0.5 break-words text-sm text-ink">{i.value}</dd></div>)}
    </dl>
  );
}

// ---- Modal -------------------------------------------------------------------------------------

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div className={clsx('relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', wide ? 'sm:max-w-4xl' : 'sm:max-w-xl')}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3"><h2 className="text-base font-semibold text-ink">{title}</h2><button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-canvas" aria-label="Close"><X className="h-5 w-5" /></button></div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---- Toasts ------------------------------------------------------------------------------------

type Toast = { id: number; tone: 'success' | 'error'; text: string };
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map((t) => <div key={t.id} className={clsx('rounded-xl px-4 py-3 text-sm text-white shadow-lg', t.tone === 'success' ? 'bg-green-700' : 'bg-red-700')}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastCtx);
  return { success: (m: string) => push('success', m), error: (e: unknown) => push('error', typeof e === 'string' ? e : parseApiError(e).message) };
}
