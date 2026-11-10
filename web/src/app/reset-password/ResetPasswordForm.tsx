'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Alert, Button, Field, PasswordField } from '@/components/ui/primitives';
import { OtpInput } from '@/components/ui/OtpInput';
import { DevOtpHint } from '@/components/auth/DevOtpHint';
import { api, applyApiError, parseApiError } from '@/lib/api';
import { useCountdown } from '@/lib/hooks';
import { resetSchema } from '@/lib/validation';

export function ResetPasswordForm({ identifier, initialCooldown }: { identifier: string; initialCooldown: number }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cooldown = useCountdown();
  const [devCode, setDevCode] = useState<string>();
  const {
    register,
    handleSubmit,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) });

  useEffect(() => {
    cooldown.start(initialCooldown);
    try {
      setDevCode(sessionStorage.getItem('tl.devResetCode') ?? undefined);
      sessionStorage.removeItem('tl.devResetCode');
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    setCodeError(null);
    if (code.length !== 6) {
      setCodeError('Enter the 6-digit code');
      return;
    }
    try {
      await api.post('/auth/reset-password', { identifier, code, ...values });
      router.replace('/login?reason=reset');
    } catch (e) {
      const err = applyApiError(e, setFieldError, ['password', 'confirmPassword']);
      if (err.code?.startsWith('OTP') || err.code === 'INVALID_OTP') {
        const remaining = (err.details as { attemptsRemaining?: number } | undefined)?.attemptsRemaining;
        setCodeError(remaining !== undefined ? `${err.message}. ${remaining} attempt(s) left.` : err.message);
        setCode('');
      } else setError(err.message);
    }
  });

  async function resend() {
    setError(null);
    try {
      const { data } = await api.post('/auth/forgot-password', { identifier });
      cooldown.start(data.data.resendAfterSeconds);
      setDevCode(data.data.devCode);
    } catch (e) {
      const err = parseApiError(e);
      setError(err.message);
      const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      if (retry) cooldown.start(retry);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {error && <Alert>{error}</Alert>}
      <DevOtpHint code={devCode} />
      <Field label="Reset code" id="reset-code" error={codeError ?? undefined} required>
        <OtpInput value={code} onChange={setCode} error={Boolean(codeError)} autoFocus />
      </Field>
      <div className="-mt-2 text-right">
        <button
          type="button"
          onClick={resend}
          disabled={cooldown.remaining > 0}
          className="text-sm font-medium text-brand-600 hover:text-brand-700 disabled:text-muted"
        >
          {cooldown.remaining > 0 ? `Resend in ${cooldown.remaining}s` : 'Resend code'}
        </button>
      </div>
      <PasswordField
        label="New password"
        autoComplete="new-password"
        hint="At least 8 characters with upper & lower case letters and a number"
        error={errors.password?.message}
        required
        {...register('password')}
      />
      <PasswordField label="Confirm new password" autoComplete="new-password" error={errors.confirmPassword?.message} required {...register('confirmPassword')} />
      <Button type="submit" fullWidth loading={isSubmitting}>
        Update password
      </Button>
    </form>
  );
}
