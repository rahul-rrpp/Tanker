'use client';

import { CheckCircle2, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { api, parseApiError } from '@/lib/api';
import { useCountdown } from '@/lib/hooks';
import { Alert, Button } from '../ui/primitives';
import { OtpInput } from '../ui/OtpInput';
import { DevOtpHint } from './DevOtpHint';

interface Props {
  destination: string;
  channel?: 'SMS' | 'EMAIL';
  /** Called with the single-use verification token once the code is verified. */
  onVerified: (token: string) => void;
  verified: boolean;
}

/**
 * Inline OTP verification used inside signup flows. Calls the shared backend endpoints
 * /auth/otp/send and /auth/otp/verify (purpose REGISTRATION).
 */
export function PhoneVerification({ destination, channel = 'SMS', onVerified, verified }: Props) {
  const [sent, setSent] = useState<{ masked: string; devCode?: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const cooldown = useCountdown();
  const label = channel === 'SMS' ? 'mobile number' : 'email';

  async function send() {
    setError(null);
    setSending(true);
    try {
      const { data } = await api.post('/auth/otp/send', { channel, destination, purpose: 'REGISTRATION' });
      setSent({ masked: data.data.destination, devCode: data.data.devCode });
      setCode('');
      cooldown.start(data.data.resendAfterSeconds);
    } catch (e) {
      const err = parseApiError(e);
      setError(err.message);
      const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      if (retry) cooldown.start(retry);
    } finally {
      setSending(false);
    }
  }

  async function verify() {
    setError(null);
    setVerifying(true);
    try {
      const { data } = await api.post('/auth/otp/verify', { channel, destination, purpose: 'REGISTRATION', code });
      onVerified(data.data.verificationToken);
    } catch (e) {
      const err = parseApiError(e);
      const remaining = (err.details as { attemptsRemaining?: number } | undefined)?.attemptsRemaining;
      setError(remaining !== undefined ? `${err.message}. ${remaining} attempt${remaining === 1 ? '' : 's'} left.` : err.message);
      if (err.code === 'OTP_EXPIRED' || err.code === 'OTP_ATTEMPTS_EXCEEDED') setSent(null);
    } finally {
      setVerifying(false);
    }
  }

  if (verified) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        <CheckCircle2 className="h-5 w-5" aria-hidden />
        <span>
          <strong className="font-semibold">{destination}</strong> verified
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-line bg-canvas/60 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <Smartphone className="h-4 w-4" aria-hidden />
        </span>
        <div className="text-sm">
          <p className="font-semibold text-ink">Verify your {label}</p>
          <p className="text-muted">
            {sent ? `Enter the code sent to ${sent.masked}.` : `We'll send a one-time code to ${destination}.`}
          </p>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      {sent ? (
        <>
          <DevOtpHint code={sent.devCode} />
          <OtpInput value={code} onChange={setCode} autoFocus label={`Code sent to your ${label}`} />
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" size="sm" onClick={send} disabled={cooldown.remaining > 0} loading={sending}>
              {cooldown.remaining > 0 ? `Resend in ${cooldown.remaining}s` : 'Resend code'}
            </Button>
            <Button onClick={verify} loading={verifying} disabled={code.length !== 6}>
              Verify code
            </Button>
          </div>
        </>
      ) : (
        <Button onClick={send} loading={sending} disabled={cooldown.remaining > 0} variant="secondary" fullWidth>
          {cooldown.remaining > 0 ? `Send code in ${cooldown.remaining}s` : 'Send verification code'}
        </Button>
      )}
    </div>
  );
}
