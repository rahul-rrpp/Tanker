'use client';

import clsx from 'clsx';
import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  label?: string;
}

/** Segmented one-time-code input with paste support and SMS autofill (autocomplete="one-time-code"). */
export function OtpInput({ value, onChange, length = 6, error, disabled, autoFocus, label = 'Verification code' }: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  const setAt = (index: number, digit: string) => {
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join('').slice(0, length));
  };

  const handleChange = (index: number, raw: string) => {
    const clean = raw.replace(/\D/g, '');
    if (clean.length > 1) {
      // SMS autofill / typing fast fills from this position.
      const merged = (digits.slice(0, index).join('') + clean).slice(0, length);
      onChange(merged);
      refs.current[Math.min(merged.length, length - 1)]?.focus();
      return;
    }
    setAt(index, clean);
    if (clean && index < length - 1) refs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      setAt(index - 1, '');
      refs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus();
    else if (e.key === 'ArrowRight' && index < length - 1) refs.current[index + 1]?.focus();
  };

  const handlePaste = (e: ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (pasted) {
      e.preventDefault();
      onChange(pasted);
      refs.current[Math.min(pasted.length, length - 1)]?.focus();
    }
  };

  return (
    <div role="group" aria-label={label} className="flex justify-between gap-2" onPaste={handlePaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          autoFocus={autoFocus && i === 0}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of ${length}`}
          aria-invalid={error || undefined}
          className={clsx(
            'h-12 w-full min-w-0 max-w-12 rounded-[var(--radius-field)] border bg-white text-center text-lg font-semibold text-ink transition-colors',
            'focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100',
            error ? 'border-danger' : 'border-line',
          )}
        />
      ))}
    </div>
  );
}
