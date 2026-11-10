'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { BadgeCheck, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PhoneVerification } from '@/components/auth/PhoneVerification';
import { Stepper } from '@/components/auth/Stepper';
import { Checkbox, TextArea } from '@/components/ui/kit';
import { Alert, Button, PasswordField, SelectField, TextField } from '@/components/ui/primitives';
import { api, applyApiError } from '@/lib/api';
import { BUSINESS_TYPES, INDIAN_STATES } from '@/lib/status';
import { checkGstin, email, fullName, password, phone, pincode } from '@/lib/validation';

const schema = z
  .object({
    companyName: z.string().trim().min(2, 'Enter your company name').max(160),
    businessType: z.string().min(1, 'Select a business type'),
    gstNumber: z.string().trim().toUpperCase(),
    state: z.string().min(2, 'Select a state'),
    city: z.string().trim().min(2, 'Enter the city').max(80),
    address: z.string().trim().min(5, 'Enter the business address').max(300),
    pincode,
    contactPersonName: fullName,
    phone,
    email,
    password,
    confirmPassword: z.string(),
  })
  .superRefine((v, ctx) => {
    const g = checkGstin(v.gstNumber);
    if (!g.ok) ctx.addIssue({ code: 'custom', path: ['gstNumber'], message: g.message });
    else if (v.state && g.state !== v.state) ctx.addIssue({ code: 'custom', path: ['gstNumber'], message: `This GSTIN is registered in ${g.state}` });
    if (v.password !== v.confirmPassword) ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Passwords do not match' });
  });

type Values = z.input<typeof schema>;
const STEP_FIELDS: (keyof Values)[][] = [
  ['companyName', 'businessType', 'gstNumber', 'state', 'city', 'address', 'pincode'],
  ['contactPersonName', 'phone', 'email', 'password', 'confirmPassword'],
];
const KNOWN = [...STEP_FIELDS[0], ...STEP_FIELDS[1]] as string[];

export function CompanyRegistrationForm() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [tokens, setTokens] = useState<{ phone?: string; email?: string }>({});
  const [verifiedFor, setVerifiedFor] = useState<{ phone?: string; email?: string }>({});
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ code: string; name: string } | null>(null);

  const {
    register,
    handleSubmit,
    trigger,
    watch,
    setValue,
    getValues,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: 'onTouched' });

  const gstValue = watch('gstNumber') ?? '';
  const gstHint = useMemo(() => {
    const g = checkGstin(gstValue);
    return g.ok ? `Valid GSTIN · registered in ${g.state}` : undefined;
  }, [gstValue]);

  const parsedPhone = phone.safeParse(watch('phone') ?? '');
  const parsedEmail = email.safeParse(watch('email') ?? '');
  const phoneOk = parsedPhone.success && verifiedFor.phone === parsedPhone.data && Boolean(tokens.phone);
  const emailOk = parsedEmail.success && verifiedFor.email === parsedEmail.data && Boolean(tokens.email);

  /**
   * Cross-field checks for one step. The schema's superRefine only runs once every field parses, so
   * while later steps are still empty it is skipped — these must be checked here explicitly.
   */
  function crossFieldOk(s: number): boolean {
    const v = getValues();
    if (s === 0) {
      const g = checkGstin(v.gstNumber ?? '');
      if (!g.ok) return setFieldError('gstNumber', { type: 'custom', message: g.message }), false;
      if (v.state && g.state !== v.state) return setFieldError('gstNumber', { type: 'custom', message: `This GSTIN is registered in ${g.state}` }), false;
    }
    if (s === 1 && v.password !== v.confirmPassword) return setFieldError('confirmPassword', { type: 'custom', message: 'Passwords do not match' }), false;
    return true;
  }

  async function next() {
    setError(null);
    if (!(await trigger(STEP_FIELDS[step]))) return;
    if (!crossFieldOk(step)) return;
    if (step === 1 && (!phoneOk || !emailOk)) {
      setError('Verify both your mobile number and email address to continue.');
      return;
    }
    setStep((s) => s + 1);
  }

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    if (!terms) return setError('Please accept the Terms and Conditions.');
    try {
      const { data } = await api.post('/auth/register', {
        ...values,
        phone: parsedPhone.success ? parsedPhone.data : values.phone,
        email: parsedEmail.success ? parsedEmail.data : values.email,
        acceptTerms: true,
        phoneVerificationToken: tokens.phone,
        emailVerificationToken: tokens.email,
        deviceInfo: 'Web browser',
      }, { timeout: 60_000 }); // one DB transaction with many writes; slow on a remote database
      setDone({ code: data.data.company.companyCode, name: values.companyName });
    } catch (e) {
      const err = applyApiError(e, setFieldError, KNOWN);
      setError(err.message);
      // Duplicate-identity conflicts carry no field details: attach them to the field so the error sits
      // next to the input the user has to change (and goes away once they fix it and continue).
      const conflictField = ({ GST_ALREADY_REGISTERED: 'gstNumber', PHONE_ALREADY_REGISTERED: 'phone', EMAIL_ALREADY_REGISTERED: 'email' } as const)[
        err.code as 'GST_ALREADY_REGISTERED' | 'PHONE_ALREADY_REGISTERED' | 'EMAIL_ALREADY_REGISTERED'
      ];
      if (conflictField) setFieldError(conflictField, { type: 'server', message: err.message });
      const firstBad = STEP_FIELDS.findIndex((fields) => (conflictField && fields.includes(conflictField)) || err.fields.some((f) => (fields as string[]).includes(f.field)));
      if (firstBad >= 0) setStep(firstBad);
      if (err.code === 'INVALID_VERIFICATION_TOKEN') {
        setTokens({});
        setVerifiedFor({});
        setStep(1);
      }
    }
  }, (invalid) => {
    // Validation failed on a field from an earlier step: go back there so the error is visible.
    const bad = STEP_FIELDS.findIndex((fields) => fields.some((f) => invalid[f]));
    if (bad >= 0) {
      setStep(bad);
      setError('Please fix the highlighted field before creating your account.');
    }
  });

  if (done) {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-6 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" aria-hidden />
        <h2 className="mt-3 text-xl font-bold text-ink">Registration successful</h2>
        <p className="mt-1 text-sm text-muted">{done.name} is registered on TankerLink.</p>
        <div className="mx-auto mt-5 max-w-xs rounded-xl border border-green-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Your company ID</p>
          <p className="mt-1 font-mono text-2xl font-bold text-ink">{done.code}</p>
          <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-orange-700">Pending verification</p>
        </div>
        <p className="mx-auto mt-4 max-w-md text-sm text-muted">Upload your GST certificate and PAN card from Company Profile so our team can verify your account.</p>
        <Button
          className="mt-6"
          onClick={() => {
            router.replace('/company/dashboard');
            router.refresh();
          }}
        >
          Go to dashboard
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <Stepper steps={['Company', 'Contact & login', 'Confirm']} current={step} />
      {error && <Alert>{error}</Alert>}

      {step === 0 && (
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <TextField label="Company name" autoComplete="organization" error={errors.companyName?.message} required {...register('companyName')} />
          </div>
          <SelectField label="Business category" placeholder="Select…" options={Object.entries(BUSINESS_TYPES).map(([value, label]) => ({ value, label }))} error={errors.businessType?.message} required {...register('businessType')} />
          <TextField
            label="GST number"
            placeholder="27AAPFU0939F1ZV"
            maxLength={15}
            className="uppercase"
            hint={gstHint}
            error={errors.gstNumber?.message}
            required
            {...register('gstNumber', {
              onChange: (e) => {
                const g = checkGstin(e.target.value);
                if (g.ok && !getValues('state')) setValue('state', g.state);
              },
            })}
          />
          <SelectField label="State" placeholder="Select state" options={INDIAN_STATES.map((s) => ({ value: s, label: s }))} error={errors.state?.message} required {...register('state')} />
          <TextField label="City" autoComplete="address-level2" error={errors.city?.message} required {...register('city')} />
          <div className="sm:col-span-2">
            <TextArea label="Business address" autoComplete="street-address" error={errors.address?.message} required {...register('address')} />
          </div>
          <TextField label="PIN code" inputMode="numeric" maxLength={6} autoComplete="postal-code" error={errors.pincode?.message} required {...register('pincode')} />
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <TextField label="Contact person name" autoComplete="name" error={errors.contactPersonName?.message} required {...register('contactPersonName')} />
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-3">
              <TextField label="Mobile number" prefix="+91" inputMode="numeric" autoComplete="tel-national" error={errors.phone?.message} required {...register('phone')} />
              {parsedPhone.success && (
                <PhoneVerification
                  key={parsedPhone.data}
                  destination={parsedPhone.data}
                  verified={phoneOk}
                  onVerified={(t) => {
                    setTokens((x) => ({ ...x, phone: t }));
                    setVerifiedFor((x) => ({ ...x, phone: parsedPhone.data }));
                  }}
                />
              )}
            </div>
            <div className="space-y-3">
              <TextField label="Email address" type="email" autoComplete="email" error={errors.email?.message} required {...register('email')} />
              {parsedEmail.success && (
                <PhoneVerification
                  key={parsedEmail.data}
                  channel="EMAIL"
                  destination={parsedEmail.data}
                  verified={emailOk}
                  onVerified={(t) => {
                    setTokens((x) => ({ ...x, email: t }));
                    setVerifiedFor((x) => ({ ...x, email: parsedEmail.data }));
                  }}
                />
              )}
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <PasswordField label="Password" autoComplete="new-password" hint="8+ characters with upper & lower case letters and a number" error={errors.password?.message} required {...register('password')} />
            <PasswordField label="Confirm password" autoComplete="new-password" error={errors.confirmPassword?.message} required {...register('confirmPassword')} />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <dl className="grid gap-x-6 gap-y-3 rounded-xl border border-line bg-canvas/60 p-5 text-sm sm:grid-cols-2">
            {[
              ['Company', getValues('companyName')],
              ['Business type', BUSINESS_TYPES[getValues('businessType')] ?? ''],
              ['GSTIN', getValues('gstNumber')],
              ['Location', `${getValues('city')}, ${getValues('state')} ${getValues('pincode')}`],
              ['Contact person', getValues('contactPersonName')],
              ['Mobile / email', `${getValues('phone')} · ${getValues('email')}`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted">{k}</dt>
                <dd className="font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="flex items-center gap-2 text-sm text-green-700">
            <BadgeCheck className="h-4 w-4" aria-hidden /> Mobile number and email verified
          </p>
          <Checkbox
            checked={terms}
            onChange={setTerms}
            label={
              <>
                I accept the{' '}
                <Link href="/terms" target="_blank" className="text-brand-600 underline">
                  Terms and Conditions
                </Link>{' '}
                and confirm the details above are correct.
              </>
            }
          />
        </div>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        {step > 0 ? (
          <Button
            variant="secondary"
            onClick={() => {
              setError(null);
              setStep((s) => s - 1);
            }}
          >
            Back
          </Button>
        ) : (
          <span />
        )}
        {step < 2 ? (
          <Button onClick={next}>Continue</Button>
        ) : (
          <Button type="submit" loading={isSubmitting} disabled={!terms}>
            Create company account
          </Button>
        )}
      </div>
    </form>
  );
}
