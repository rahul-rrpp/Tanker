'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { AuthHeading, AuthShell } from '@/components/auth/AuthShell';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';
import { forgotSchema } from '@/lib/validation';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof forgotSchema>>({ resolver: zodResolver(forgotSchema) });

  const onSubmit = handleSubmit(async ({ identifier }) => {
    setError(null);
    try {
      const { data } = await api.post('/auth/forgot-password', { identifier });
      try {
        // Development OTP simulation only (never returned in production).
        if (data.data.devCode) sessionStorage.setItem('tl.devResetCode', data.data.devCode);
      } catch {
        /* storage unavailable */
      }
      router.push(`/reset-password?${new URLSearchParams({ identifier, cooldown: String(data.data.resendAfterSeconds) })}`);
    } catch (e) {
      setError(parseApiError(e).message);
    }
  });

  return (
    <AuthShell>
      <AuthHeading title="Reset your password" subtitle="Enter your registered mobile number or email and we'll send you a reset code." />
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Mobile number or email"
          autoComplete="username"
          placeholder="98765 43210 or you@company.com"
          error={errors.identifier?.message}
          required
          {...register('identifier')}
        />
        <Button type="submit" fullWidth loading={isSubmitting}>
          Send reset code
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        Remembered it?{' '}
        <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-700">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
