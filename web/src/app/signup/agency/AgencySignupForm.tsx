'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PhoneVerification } from '@/components/auth/PhoneVerification';
import { Stepper } from '@/components/auth/Stepper';
import { Alert, Button, PasswordField, SelectField, TextField } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';
import type { AuthResponse } from '@/lib/types';
import { agencyStep1, agencyStep2, agencyStep3, INDIAN_STATES } from '@/lib/validation';

const STEPS = ['Company', 'Business', 'Verify'];
const STEP_SCHEMAS = [agencyStep1, agencyStep2, agencyStep3] as const;
const STEP_FIELDS = [
  ['companyName', 'ownerName', 'phone', 'email', 'password', 'confirmPassword'],
  ['gstNumber', 'panNumber', 'address', 'city', 'state', 'pincode'],
  ['acceptTerms'],
] as const;

type Values = z.input<typeof agencyStep1> & z.input<typeof agencyStep2> & z.input<typeof agencyStep3>;

export function AgencySignupForm({ emailVerificationRequired }: { emailVerificationRequired: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [phoneToken, setPhoneToken] = useState<string | null>(null);
  const [emailToken, setEmailToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<Values>({
    // Each step validates only its own schema.
    resolver: (values, ctx, opts) => zodResolver(STEP_SCHEMAS[step] as z.ZodTypeAny)(values, ctx, opts as never),
    defaultValues: { acceptTerms: false, gstNumber: '' },
    mode: 'onTouched',
  });
  const {
    register,
    handleSubmit,
    getValues,
    setError: setFieldError,
    formState: { errors },
  } = form;

  const phone = (getValues('phone') ?? '').replace(/\D/g, '').slice(-10);
  const email = (getValues('email') ?? '').trim().toLowerCase();

  const goBack = () => {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  };

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    if (step < 2) {
      if (step === 0) {
        // Changing the number after verifying invalidates the earlier verification.
        setPhoneToken(null);
        setEmailToken(null);
      }
      setStep(step + 1);
      return;
    }
    if (!phoneToken) return setError('Verify your mobile number to continue.');
    if (emailVerificationRequired && !emailToken) return setError('Verify your email address to continue.');

    setSubmitting(true);
    try {
      const all = getValues();
      const { data } = await api.post<{ data: AuthResponse }>('/auth/register/agency', {
        ...all,
        phone,
        email,
        gstNumber: all.gstNumber || undefined,
        acceptTerms: true,
        phoneVerificationToken: phoneToken,
        emailVerificationToken: emailToken ?? undefined,
        deviceInfo: 'Web browser',
      });
      router.replace(data.data.redirectTo);
      router.refresh();
    } catch (e) {
      const err = parseApiError(e);
      // Jump back to the step that owns the first invalid field.
      const fieldStep = err.fields.length
        ? STEP_FIELDS.findIndex((fields) => (fields as readonly string[]).includes(err.fields[0].field))
        : -1;
      err.fields.forEach((f) => setFieldError(f.field as keyof Values, { type: 'server', message: f.message }));
      if (fieldStep >= 0) setStep(fieldStep);
      if (err.code === 'INVALID_VERIFICATION_TOKEN') setPhoneToken(null);
      setError(err.message);
      setSubmitting(false);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stepper steps={STEPS} current={step} />
      {error && (
        <div className="mb-5">
          <Alert>{error}</Alert>
        </div>
      )}

      {step === 0 && (
        <fieldset className="grid gap-5 sm:grid-cols-2">
          <legend className="sr-only">Company information</legend>
          <div className="sm:col-span-2">
            <TextField label="Company name" autoComplete="organization" error={errors.companyName?.message} required {...register('companyName')} />
          </div>
          <TextField label="Owner name" autoComplete="name" error={errors.ownerName?.message} required {...register('ownerName')} />
          <TextField label="Mobile number" prefix="+91" inputMode="tel" autoComplete="tel-national" error={errors.phone?.message} required {...register('phone')} />
          <div className="sm:col-span-2">
            <TextField label="Email" type="email" autoComplete="email" error={errors.email?.message} required {...register('email')} />
          </div>
          <PasswordField
            label="Password"
            autoComplete="new-password"
            hint="8+ characters, upper & lower case, a number"
            error={errors.password?.message}
            required
            {...register('password')}
          />
          <PasswordField label="Confirm password" autoComplete="new-password" error={errors.confirmPassword?.message} required {...register('confirmPassword')} />
        </fieldset>
      )}

      {step === 1 && (
        <fieldset className="grid gap-5 sm:grid-cols-2">
          <legend className="sr-only">Business information</legend>
          <TextField label="PAN number" placeholder="ABCDE1234F" className="uppercase" maxLength={10} error={errors.panNumber?.message} required {...register('panNumber')} />
          <TextField
            label="GST number"
            placeholder="27ABCDE1234F1Z5"
            className="uppercase"
            maxLength={15}
            hint="Optional if not GST-registered"
            error={errors.gstNumber?.message}
            {...register('gstNumber')}
          />
          <div className="sm:col-span-2">
            <TextField label="Business address" autoComplete="street-address" error={errors.address?.message} required {...register('address')} />
          </div>
          <TextField label="City" autoComplete="address-level2" error={errors.city?.message} required {...register('city')} />
          <SelectField label="State" options={INDIAN_STATES} placeholder="Select state" error={errors.state?.message} required {...register('state')} />
          <TextField label="PIN code" inputMode="numeric" autoComplete="postal-code" maxLength={6} error={errors.pincode?.message} required {...register('pincode')} />
        </fieldset>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <PhoneVerification destination={phone} verified={Boolean(phoneToken)} onVerified={setPhoneToken} />
          {emailVerificationRequired && (
            <PhoneVerification destination={email} channel="EMAIL" verified={Boolean(emailToken)} onVerified={setEmailToken} />
          )}
          <label className="flex items-start gap-3 text-sm text-ink">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-line accent-brand-600" {...register('acceptTerms')} />
            <span>
              I agree to the{' '}
              <Link href="/terms" target="_blank" className="font-medium text-brand-600 underline-offset-2 hover:underline">
                Terms and Conditions
              </Link>{' '}
              and confirm the business details are accurate.
            </span>
          </label>
          {errors.acceptTerms && (
            <p role="alert" className="-mt-3 text-xs font-medium text-danger">
              {errors.acceptTerms.message}
            </p>
          )}
          <Alert tone="info">After you submit, our team verifies your GST/PAN details. You can sign in and track the status meanwhile.</Alert>
        </div>
      )}

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        {step > 0 ? (
          <Button variant="secondary" onClick={goBack} disabled={submitting}>
            Back
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" loading={submitting} disabled={step === 2 && !phoneToken}>
          {step < 2 ? 'Continue' : 'Submit registration'}
        </Button>
      </div>
    </form>
  );
}
