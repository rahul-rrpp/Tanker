'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Alert, Button, PasswordField, TextField } from '@/components/ui/primitives';
import { api, applyApiError } from '@/lib/api';
import type { AuthResponse } from '@/lib/types';
import { simpleSignupSchema } from '@/lib/validation';

type In = z.input<typeof simpleSignupSchema>;
type Out = z.output<typeof simpleSignupSchema>;

export function SignupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<In, unknown, Out>({ resolver: zodResolver(simpleSignupSchema), mode: 'onTouched' });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const { data } = await api.post<{ data: AuthResponse }>('/auth/register', { ...values, deviceInfo: 'Web browser' });
      router.replace(data.data.redirectTo);
      router.refresh();
    } catch (e) {
      setError(applyApiError(e, setFieldError, ['fullName', 'phone', 'password']).message);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {error && <Alert>{error}</Alert>}
      <TextField label="Full name" autoComplete="name" error={errors.fullName?.message} required {...register('fullName')} />
      <TextField
        label="Mobile number"
        prefix="+91"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="98765 43210"
        error={errors.phone?.message}
        required
        {...register('phone')}
      />
      <PasswordField
        label="Password"
        autoComplete="new-password"
        hint="At least 8 characters with an uppercase letter, a lowercase letter and a number"
        error={errors.password?.message}
        required
        {...register('password')}
      />
      <Button type="submit" fullWidth loading={isSubmitting}>
        Create account
      </Button>
    </form>
  );
}
