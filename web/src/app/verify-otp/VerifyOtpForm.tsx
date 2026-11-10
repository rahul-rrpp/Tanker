'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button } from '@/components/ui/primitives';
import { OtpInput } from '@/components/ui/OtpInput';
import { api, parseApiError } from '@/lib/api';
import { useCountdown } from '@/lib/hooks';
import { safeNext } from '@/lib/navigation';
import type { AuthResponse } from '@/lib/types';

export function VerifyOtpForm({ phone, next, initialCooldown }: { phone: string; next?: string; initialCooldown: number }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const cooldown = useCountdown();

  useEffect(() => {
    cooldown.start(initialCooldown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verify(value = code) {
    if (value.length !== 6 || verifying) return;
    setError(null);
    setVerifying(true);
    try {
      const { data } = await api.post<{ data: AuthResponse }>('/auth/login/otp/verify', { phone, code: value, deviceInfo: 'Web browser' });
      const target = data.data.redirectTo === '/pending-verification' ? data.data.redirectTo : (safeNext(next) ?? data.data.redirectTo);
      router.replace(target);
      router.refresh();
    } catch (e) {
      const err = parseApiError(e);
      const remaining = (err.details as { attemptsRemaining?: number } | undefined)?.attemptsRemaining;
      setError(remaining !== undefined ? `${err.message}. ${remaining} attempt${remaining === 1 ? '' : 's'} left.` : err.message);
      setCode('');
      setVerifying(false);
    }
  }

  async function resend() {
    setError(null);
    setInfo(null);
    setResending(true);
    try {
      const { data } = await api.post('/auth/login/otp/send', { phone });
      cooldown.start(data.data.resendAfterSeconds);
      setInfo('A new code has been sent.');
    } catch (e) {
      const err = parseApiError(e);
      setError(err.message);
      const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      if (retry) cooldown.start(retry);
    } finally {
      setResending(false);
    }
  }

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void verify();
      }}
    >
      {error && <Alert>{error}</Alert>}
      {info && !error && <Alert tone="success">{info}</Alert>}
      <OtpInput
        value={code}
        onChange={(v) => {
          setCode(v);
          if (v.length === 6) void verify(v);
        }}
        autoFocus
        error={Boolean(error)}
        disabled={verifying}
      />
      <Button type="submit" fullWidth loading={verifying} disabled={code.length !== 6}>
        Verify &amp; sign in
      </Button>
      <p className="text-center text-sm text-muted">
        Didn&apos;t get the code?{' '}
        <button
          type="button"
          onClick={resend}
          disabled={cooldown.remaining > 0 || resending}
          className="font-semibold text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:text-muted"
        >
          {cooldown.remaining > 0 ? `Resend in ${cooldown.remaining}s` : 'Resend OTP'}
        </button>
      </p>
    </form>
  );
}
