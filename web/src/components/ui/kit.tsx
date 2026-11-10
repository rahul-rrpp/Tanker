'use client';

import clsx from 'clsx';
import { AlertTriangle, ChevronLeft, ChevronRight, FlaskConical, Inbox, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useState, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { parseApiError } from '@/lib/api';
import type { Tone } from '@/lib/status';
import { Alert, Badge, Button, Field } from './primitives';

// ---------------------------------------------------------------------------
// Status / demo badges
// ---------------------------------------------------------------------------

export function StatusBadge({ map, value }: { map: Record<string, { label: string; tone: Tone }>; value: string | null | undefined }) {
  if (!value) return null;
  const meta = map[value] ?? { label: value, tone: 'neutral' as Tone };
  const dot = { neutral: 'bg-slate-400', info: 'bg-brand-500', warning: 'bg-orange-500', success: 'bg-green-600', danger: 'bg-red-600' }[meta.tone];
  return (
    <Badge tone={meta.tone}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', dot)} aria-hidden />
      {meta.label}
    </Badge>
  );
}

export function DemoBadge({ label = 'Demo' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-fuchsia-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-fuchsia-700 ring-1 ring-inset ring-fuchsia-200" title="Demo data — not a real transaction">
      <FlaskConical className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {/* Navigation context comes from the portal breadcrumbs; `back` is kept for API compatibility. */}
        {back && <span className="sr-only">Back to {back.label}</span>}
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-ink">{children}</h2>
      {action}
    </div>
  );
}

export function StatCard({ label, value, icon, tone = 'brand', hint, href }: { label: string; value: ReactNode; icon: ReactNode; tone?: 'brand' | 'orange' | 'green' | 'red' | 'navy'; hint?: string; href?: string }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600',
    orange: 'bg-orange-50 text-orange-600',
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    navy: 'bg-slate-100 text-ink',
  }[tone];
  const body = (
    <div className="flex h-full items-start justify-between gap-3 rounded-2xl border border-line bg-white p-4 shadow-[var(--shadow-card)] transition-colors hover:border-brand-200 sm:p-5">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <p className="mt-2 truncate text-2xl font-bold tabular-nums text-ink">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      </div>
      <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', tones)}>{icon}</span>
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-white px-6 py-12 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-canvas text-muted">{icon ?? <Inbox className="h-6 w-6" aria-hidden />}</span>
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-lg bg-slate-200/70', className)} aria-hidden />;
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = parseApiError(error).message;
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        Could not load this section
      </p>
      <p className="mt-1">{msg}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export function Tabs<T extends string>({ tabs, value, onChange, counts }: { tabs: { value: T; label: string }[]; value: T; onChange: (v: T) => void; counts?: Partial<Record<T, number>> }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div role="tablist" className="inline-flex min-w-full gap-1 border-b border-line">
        {tabs.map((t) => {
          const active = t.value === value;
          return (
            <button
              key={t.value}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.value)}
              className={clsx(
                '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                active ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink',
              )}
            >
              {t.label}
              {counts?.[t.value] !== undefined && (
                <span className={clsx('rounded-full px-1.5 text-xs tabular-nums', active ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600')}>{counts[t.value]}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between gap-3 pt-4 text-sm text-muted">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form bits
// ---------------------------------------------------------------------------

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: ReactNode }>(function TextArea(
  { label, error, hint, required, id, className, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <Field label={label} error={error} hint={hint} required={required} id={fieldId}>
      <textarea
        ref={ref}
        id={fieldId}
        rows={3}
        aria-invalid={Boolean(error) || undefined}
        className={clsx(
          'block w-full rounded-[var(--radius-field)] border bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100',
          error ? 'border-danger' : 'border-line',
          className,
        )}
        {...rest}
      />
    </Field>
  );
});

export function Checkbox({ label, checked, onChange, description }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; description?: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-sm">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-line accent-brand-600" />
      <span>
        <span className="font-medium text-ink">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50', checked ? 'bg-brand-600' : 'bg-slate-300')}
    >
      <span className={clsx('inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Modal & confirm
// ---------------------------------------------------------------------------

export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={clsx('flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl', size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-canvas hover:text-ink" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

type ToastItem = { id: number; tone: 'success' | 'error' | 'info'; message: string };
const ToastCtx = createContext<{ push: (tone: ToastItem['tone'], message: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: ToastItem['tone'], message: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, tone, message }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[1100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto w-full max-w-sm shadow-lg">
            <Alert tone={t.tone === 'error' ? 'error' : t.tone === 'success' ? 'success' : 'info'}>{t.message}</Alert>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  return {
    success: (m: string) => ctx?.push('success', m),
    error: (e: unknown) => ctx?.push('error', typeof e === 'string' ? e : parseApiError(e).message),
    info: (m: string) => ctx?.push('info', m),
  };
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('h-4 w-4 animate-spin', className)} aria-hidden />;
}

/** Key/value row used across detail pages. */
export function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
      <dt className="w-44 shrink-0 text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-sm font-medium text-ink">{children ?? '—'}</dd>
    </div>
  );
}
