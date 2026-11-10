'use client';

import clsx from 'clsx';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Info, Loader2 } from 'lucide-react';
import { forwardRef, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  fullWidth?: boolean;
  size?: 'md' | 'sm';
}

const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm',
  secondary: 'bg-white text-ink border border-line hover:bg-canvas',
  ghost: 'text-brand-600 hover:bg-brand-50',
  danger: 'bg-danger text-white hover:opacity-90',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', loading, fullWidth, size = 'md', className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-[var(--radius-field)] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        size === 'md' ? 'h-11 px-5 text-sm' : 'h-9 px-3 text-sm',
        variants[variant],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Field wrapper
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  id: string;
  children: ReactNode;
}

export function Field({ label, error, hint, required, id, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="flex items-center gap-1 text-xs font-medium text-danger">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const inputClass = (error?: string, extra?: string) =>
  clsx(
    'block h-11 w-full rounded-[var(--radius-field)] border bg-white px-3.5 text-sm text-ink placeholder:text-slate-400 transition-colors',
    'focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:bg-canvas',
    error ? 'border-danger focus:border-danger focus:ring-red-100' : 'border-line',
    extra,
  );

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: ReactNode;
  prefix?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, required, prefix, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <Field label={label} error={error} hint={hint} required={required} id={fieldId}>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center border-r border-line pl-3.5 pr-3 text-sm text-muted">
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          aria-required={required || undefined}
          className={inputClass(error, clsx(prefix && 'pl-[4.25rem]', className))}
          {...rest}
        />
      </div>
    </Field>
  );
});

export const PasswordField = forwardRef<HTMLInputElement, Omit<TextFieldProps, 'type'>>(function PasswordField(
  { label, error, hint, required, id, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} error={error} hint={hint} required={required} id={fieldId}>
      <div className="relative">
        <input
          ref={ref}
          id={fieldId}
          type={visible ? 'text' : 'password'}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          className={inputClass(error, 'pr-11')}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted hover:text-ink"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </Field>
  );
});

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  /** Either pass options, or <option> children for grouped or conditional lists. */
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: ReactNode;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, error, required, options, placeholder, hint, id, children, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <Field label={label} error={error} hint={hint} required={required} id={fieldId}>
      <select
        ref={ref}
        id={fieldId}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={inputClass(error, 'appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 20 20%27 fill=%27%235b6676%27%3E%3Cpath d=%27M5.5 7.5 10 12l4.5-4.5%27 stroke=%27%235b6676%27 stroke-width=%271.5%27 fill=%27none%27/%3E%3C/svg%3E")] bg-[length:1.25rem] bg-[right_0.75rem_center] bg-no-repeat pr-10')}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
    </Field>
  );
});

// ---------------------------------------------------------------------------
// Alert
// ---------------------------------------------------------------------------

export function Alert({ tone = 'error', title, children }: { tone?: 'error' | 'success' | 'info'; title?: string; children?: ReactNode }) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-green-200 bg-green-50 text-green-800',
    info: 'border-brand-200 bg-brand-50 text-brand-800',
  }[tone];
  const Icon = tone === 'error' ? AlertCircle : tone === 'success' ? CheckCircle2 : Info;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={clsx('flex gap-3 rounded-[var(--radius-field)] border px-4 py-3 text-sm', styles)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx(title && 'mt-0.5')}>{children}</div>}
      </div>
    </div>
  );
}

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'info' | 'warning' | 'success' | 'danger'; children: ReactNode; className?: string }) {
  const styles = {
    neutral: 'bg-slate-100 text-slate-700',
    info: 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100',
    warning: 'bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-100',
    success: 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-100',
    danger: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-100',
  }[tone];
  return <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', styles, className)}>{children}</span>;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6', className)}>{children}</div>;
}
