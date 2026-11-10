'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { Alert, Button } from '../ui/primitives';
import { api, parseApiError } from '@/lib/api';
import type { AuthResponse } from '@/lib/types';
import { PhoneVerification } from './PhoneVerification';

/**
 * Two-phase signup used by driver and customer: details form → phone OTP → submit.
 * The phone is locked once verification starts so the verified number is the one registered.
 */
export function SimpleSignup<T extends FieldValues>({
  form,
  endpoint,
  toPayload,
  children,
}: {
  form: UseFormReturn<T>;
  endpoint: string;
  toPayload: (values: T) => Record<string, unknown>;
  children: (locked: boolean) => ReactNode;
}) {
  const router = useRouter();
  const [details, setDetails] = useState<Record<string, unknown> | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onContinue = form.handleSubmit((values) => {
    setError(null);
    setDetails(toPayload(values));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  async function submit() {
    if (!details || !token) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post<{ data: AuthResponse }>(endpoint, { ...details, phoneVerificationToken: token, deviceInfo: 'Web browser' });
      router.replace(data.data.redirectTo);
      router.refresh();
    } catch (e) {
      const err = parseApiError(e);
      err.fields.forEach((f) => form.setError(f.field as never, { type: 'server', message: f.message }));
      if (err.fields.length || err.code === 'PHONE_ALREADY_REGISTERED' || err.code === 'EMAIL_ALREADY_REGISTERED') setDetails(null);
      if (err.code === 'INVALID_VERIFICATION_TOKEN') setToken(null);
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      <form onSubmit={onContinue} noValidate className="space-y-6">
        {children(Boolean(details))}
        {!details && (
          <Button type="submit" fullWidth>
            Continue to verification
          </Button>
        )}
      </form>
      {details && (
        <div className="space-y-4">
          <PhoneVerification destination={String(details.phone)} verified={Boolean(token)} onVerified={setToken} />
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <Button
              variant="secondary"
              onClick={() => {
                setDetails(null);
                setToken(null);
              }}
              disabled={submitting}
            >
              Edit details
            </Button>
            <Button onClick={submit} loading={submitting} disabled={!token}>
              Create account
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
