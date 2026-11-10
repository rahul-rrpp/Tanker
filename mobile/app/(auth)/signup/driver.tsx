import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormField } from '@/components/FormField';
import { TwoPhaseSignup } from '@/components/TwoPhaseSignup';
import { ChoiceChips } from '@/components/ui';
import { driverSchema, LICENCE_TYPES } from '@/lib/validation';

type In = z.input<typeof driverSchema>;
type Out = z.output<typeof driverSchema>;
type LicenceType = Out['licenceType'];

export default function DriverSignup() {
  const form = useForm<In, unknown, Out>({ resolver: zodResolver(driverSchema) });
  const { control } = form;
  return (
    <TwoPhaseSignup
      title="Driver registration"
      subtitle="You need the invitation code from your transport agency."
      form={form as never}
      endpoint="/auth/register/driver"
      toPayload={(v: Out) => ({
        ...v,
        email: v.email || undefined,
        password: v.password || undefined,
        confirmPassword: v.password ? v.confirmPassword : undefined,
      })}
    >
      <FormField control={control} name="invitationCode" label="Agency invitation code" autoCapitalize="characters" placeholder="K7QM-2XPA" required />
      <FormField control={control} name="fullName" label="Full name" autoComplete="name" required />
      <FormField control={control} name="phone" label="Mobile number" prefix="+91" keyboardType="phone-pad" required />
      <FormField control={control} name="email" label="Email" keyboardType="email-address" autoCapitalize="none" hint="Optional" />
      <FormField control={control} name="licenceNumber" label="Driving licence number" autoCapitalize="characters" placeholder="MH1420110012345" required />
      <Controller
        control={control}
        name="licenceType"
        render={({ field, fieldState }) => (
          <ChoiceChips<LicenceType>
            label="Licence type"
            options={LICENCE_TYPES.map((t) => ({ value: t.value, label: t.value }))}
            value={field.value as LicenceType | undefined}
            onChange={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <FormField control={control} name="licenceExpiry" label="Licence expiry date" placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} required />
      <FormField control={control} name="password" label="Password" password hint="Optional — leave blank to sign in with OTP" />
      <FormField control={control} name="confirmPassword" label="Confirm password" password />
    </TwoPhaseSignup>
  );
}
