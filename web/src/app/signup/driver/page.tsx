'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { AuthHeading, AuthShell } from '@/components/auth/AuthShell';
import { SimpleSignup } from '@/components/auth/SimpleSignup';
import { Alert, PasswordField, SelectField, TextField } from '@/components/ui/primitives';
import { driverSchema, LICENCE_TYPES } from '@/lib/validation';

type In = z.input<typeof driverSchema>;
type Out = z.output<typeof driverSchema>;

export default function DriverSignupPage() {
  const form = useForm<In, unknown, Out>({ resolver: zodResolver(driverSchema), mode: 'onTouched' });
  const {
    register,
    formState: { errors },
  } = form;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <AuthShell wide>
      <AuthHeading title="Register as a driver" subtitle="Use the invitation code your agency shared with you." />
      <div className="mb-6">
        <Alert tone="info">Drivers mostly use the TTMS mobile app. You can register here and sign in on your phone later.</Alert>
      </div>
      <SimpleSignup
        form={form as never}
        endpoint="/auth/register/driver"
        toPayload={(v: Out) => ({
          ...v,
          email: v.email || undefined,
          password: v.password || undefined,
          confirmPassword: v.password ? v.confirmPassword : undefined,
        })}
      >
        {(locked) => (
          <fieldset disabled={locked} className="grid gap-5 sm:grid-cols-2">
            <legend className="sr-only">Driver details</legend>
            <div className="sm:col-span-2">
              <TextField
                label="Agency invitation code"
                placeholder="K7QM-2XPA"
                className="uppercase tracking-widest"
                autoComplete="off"
                error={errors.invitationCode?.message}
                required
                {...register('invitationCode')}
              />
            </div>
            <TextField label="Full name" autoComplete="name" error={errors.fullName?.message} required {...register('fullName')} />
            <TextField label="Mobile number" prefix="+91" inputMode="tel" autoComplete="tel-national" error={errors.phone?.message} required {...register('phone')} />
            <div className="sm:col-span-2">
              <TextField label="Email" type="email" autoComplete="email" hint="Optional" error={errors.email?.message} {...register('email')} />
            </div>
            <TextField label="Driving licence number" placeholder="MH1420110012345" className="uppercase" error={errors.licenceNumber?.message} required {...register('licenceNumber')} />
            <SelectField label="Licence type" options={[...LICENCE_TYPES]} placeholder="Select type" error={errors.licenceType?.message} required {...register('licenceType')} />
            <TextField label="Licence expiry date" type="date" min={today} error={errors.licenceExpiry?.message} required {...register('licenceExpiry')} />
            <div className="hidden sm:block" />
            <PasswordField label="Password" autoComplete="new-password" hint="Optional — leave blank to sign in with OTP" error={errors.password?.message} {...register('password')} />
            <PasswordField label="Confirm password" autoComplete="new-password" error={errors.confirmPassword?.message} {...register('confirmPassword')} />
          </fieldset>
        )}
      </SimpleSignup>
      <p className="mt-8 text-center text-sm text-muted">
        <Link href="/signup" className="font-semibold text-brand-600 hover:text-brand-700">
          Choose another account type
        </Link>
      </p>
    </AuthShell>
  );
}
