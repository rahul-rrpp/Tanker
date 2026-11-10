'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { DevOtpHint } from '@/components/auth/DevOtpHint';
import { Checkbox } from '@/components/ui/kit';
import { OtpInput } from '@/components/ui/OtpInput';
import { Alert, Button, PasswordField, TextField } from '@/components/ui/primitives';
import { api, applyApiError, parseApiError } from '@/lib/api';
import { useCountdown } from '@/lib/hooks';
import { safeNext } from '@/lib/navigation';
import type { AuthResponse } from '@/lib/types';
import { loginSchema, phone as phoneSchema } from '@/lib/validation';

type Mode = 'password' | 'otp';

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('password');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const finish = (data: AuthResponse) => {
    router.replace(safeNext(next) ?? data.redirectTo);
    router.refresh();
  };

  return (
    <div className="space-y-5">
      {notice && <Alert tone="info">{notice}</Alert>}
      <div role="tablist" className="grid grid-cols-2 rounded-xl bg-canvas p-1 text-sm font-semibold">
        {(['password', 'otp'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={clsx('rounded-lg py-2 transition-colors', mode === m ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink')}
          >
            {m === 'password' ? 'Password' : 'OTP on mobile'}
          </button>
        ))}
      </div>
      {error && <Alert>{error}</Alert>}
      {mode === 'password' ? (
        <PasswordLogin remember={remember} setRemember={setRemember} onDone={finish} onError={setError} />
      ) : (
        <OtpLogin remember={remember} setRemember={setRemember} onDone={finish} onError={setError} />
      )}
    </div>
  );
}

interface FormProps {
  remember: boolean;
  setRemember: (v: boolean) => void;
  onDone: (d: AuthResponse) => void;
  onError: (m: string | null) => void;
}

function lockMessage(err: ReturnType<typeof parseApiError>) {
  if (err.code === 'ACCOUNT_LOCKED') {
    const s = (err.details as { retryAfterSeconds?: number })?.retryAfterSeconds ?? 0;
    return `${err.message} Try again in ${Math.ceil(s / 60)} minute(s) or reset your password.`;
  }
  return err.message;
}

function PasswordLogin({ remember, setRemember, onDone, onError }: FormProps) {
  const {
    register,
    handleSubmit,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    onError(null);
    try {
      const { data } = await api.post<{ data: AuthResponse }>('/auth/login', { ...values, rememberMe: remember, deviceInfo: 'Web browser' });
      onDone(data.data);
    } catch (e) {
      onError(lockMessage(applyApiError(e, setFieldError, ['identifier', 'password'])));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <TextField label="Mobile number or email" autoComplete="username" placeholder="98765 43210 or you@company.com" error={errors.identifier?.message} required {...register('identifier')} />
      <PasswordField label="Password" autoComplete="current-password" error={errors.password?.message} required {...register('password')} />
      <div className="flex items-center justify-between gap-3">
        <Checkbox label="Remember me" checked={remember} onChange={setRemember} />
        <Link href="/forgot-password" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          Forgot password?
        </Link>
      </div>
      <Button type="submit" fullWidth loading={isSubmitting}>
        Sign in
      </Button>
    </form>
  );
}

function OtpLogin({ remember, setRemember, onDone, onError }: FormProps) {
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string>();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const cooldown = useCountdown();

  async function send() {
    onError(null);
    const parsed = phoneSchema.safeParse(phone);
    if (!parsed.success) return setPhoneError(parsed.error.issues[0].message);
    setPhoneError(undefined);
    setBusy(true);
    try {
      const { data } = await api.post('/auth/login/otp/send', { phone: parsed.data });
      setSentTo(parsed.data);
      setDevCode(data.data.devCode);
      setCode('');
      cooldown.start(data.data.resendAfterSeconds);
    } catch (e) {
      const err = parseApiError(e);
      onError(err.message);
      const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      if (retry) cooldown.start(retry);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    onError(null);
    setBusy(true);
    try {
      const { data } = await api.post<{ data: AuthResponse }>('/auth/login/otp/verify', { phone: sentTo, code, rememberMe: remember, deviceInfo: 'Web browser' });
      onDone(data.data);
    } catch (e) {
      const err = parseApiError(e);
      const left = (err.details as { attemptsRemaining?: number } | undefined)?.attemptsRemaining;
      onError(left !== undefined ? `${err.message}. ${left} attempt(s) left.` : lockMessage(err));
      if (err.code === 'OTP_EXPIRED' || err.code === 'OTP_ATTEMPTS_EXCEEDED') setSentTo(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <TextField label="Registered mobile number" prefix="+91" inputMode="numeric" autoComplete="tel-national" value={phone} onChange={(e) => setPhone(e.target.value)} error={phoneError} disabled={Boolean(sentTo)} required />
      {sentTo ? (
        <>
          <p className="text-sm text-muted">If this number is registered, a 6-digit code has been sent to it.</p>
          <DevOtpHint code={devCode} />
          <OtpInput value={code} onChange={setCode} autoFocus />
          <Checkbox label="Remember me" checked={remember} onChange={setRemember} />
          <Button fullWidth onClick={verify} loading={busy} disabled={code.length !== 6}>
            Verify &amp; sign in
          </Button>
          <div className="flex justify-between text-sm">
            <button className="font-medium text-brand-600 hover:text-brand-700" onClick={() => setSentTo(null)}>
              Change number
            </button>
            <button className="font-medium text-brand-600 hover:text-brand-700 disabled:text-muted" onClick={send} disabled={cooldown.remaining > 0 || busy}>
              {cooldown.remaining > 0 ? `Resend in ${cooldown.remaining}s` : 'Resend code'}
            </button>
          </div>
        </>
      ) : (
        <Button fullWidth onClick={send} loading={busy} disabled={cooldown.remaining > 0}>
          {cooldown.remaining > 0 ? `Send code in ${cooldown.remaining}s` : 'Send OTP'}
        </Button>
      )}
    </div>
  );
}
