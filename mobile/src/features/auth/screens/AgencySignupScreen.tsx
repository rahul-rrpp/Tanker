import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, Text, View } from 'react-native';
import { z } from 'zod';
import { parseApiError, ENDPOINTS } from '@/services/api';
import { useAuth } from '@/features/auth/context/AuthContext';
import { FormField } from '@/components/forms';
import { RegistrationOtp } from '@/features/auth/components/RegistrationOtp';
import { Banner, Button } from '@/components/ui';
import { Heading, Screen } from '@/components/layout';
import { colors } from '@/theme';
import { useBackHandler } from '@/hooks';
import { agencyStep1, agencyStep2, agencyStep3 } from '@/features/auth/validation/schemas';
import { authService } from '../services/authService';

const STEPS = ['Company', 'Business', 'Verify'];
const SCHEMAS = [agencyStep1, agencyStep2, agencyStep3] as const;
const STEP_FIELDS: string[][] = [
  ['companyName', 'ownerName', 'phone', 'email', 'password', 'confirmPassword'],
  ['gstNumber', 'panNumber', 'address', 'city', 'state', 'pincode'],
  ['acceptTerms'],
];
type Values = z.input<typeof agencyStep1> & z.input<typeof agencyStep2> & z.input<typeof agencyStep3>;

export default function AgencySignupScreen() {
  const { signIn } = useAuth();
  const [step, setStep] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { control, handleSubmit, getValues, setError: setFieldError } = useForm<Values>({
    resolver: (values, ctx, opts) => zodResolver(SCHEMAS[step] as z.ZodTypeAny)(values, ctx, opts as never),
    defaultValues: { acceptTerms: false, gstNumber: '' },
  });
  const phone = (getValues('phone') ?? '').replace(/\D/g, '').slice(-10);

  // Android back button walks back through the steps before leaving the screen.
  useBackHandler(
    useCallback(() => {
      if (step > 0 && !submitting) {
        setStep((s) => s - 1);
        return true;
      }
      return false;
    }, [step, submitting]),
  );

  const next = handleSubmit(async () => {
    setError(null);
    if (step === 0) setToken(null);
    if (step < 2) return setStep(step + 1);
    if (!token) return setError('Verify your mobile number to continue.');
    setSubmitting(true);
    try {
      const v = getValues();
      const { data } = await authService.register(ENDPOINTS.auth.registerAgency, {
        ...v,
        phone,
        email: v.email.trim().toLowerCase(),
        gstNumber: v.gstNumber || undefined,
        acceptTerms: true,
        phoneVerificationToken: token,
      });
      await signIn(data.data);
    } catch (e) {
      const err = parseApiError(e);
      err.fields.forEach((f) => setFieldError(f.field as keyof Values, { message: f.message }));
      const s = err.fields.length ? STEP_FIELDS.findIndex((fs) => fs.includes(err.fields[0].field)) : -1;
      if (s >= 0) setStep(s);
      if (err.code === 'INVALID_VERIFICATION_TOKEN') setToken(null);
      setError(err.message);
      setSubmitting(false);
    }
  });

  return (
    <Screen
      footer={
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {step > 0 ? <Button title="Back" variant="secondary" onPress={() => setStep(step - 1)} style={{ flex: 1 }} disabled={submitting} /> : null}
          <Button title={step < 2 ? 'Continue' : 'Submit'} onPress={next} loading={submitting} disabled={step === 2 && !token} style={{ flex: 2 }} />
        </View>
      }
    >
      <Heading title="Register your agency" subtitle={`Step ${step + 1} of 3 · ${STEPS[step]}`} />
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 20 }} accessibilityLabel={`Step ${step + 1} of 3`}>
        {STEPS.map((s, i) => (
          <View key={s} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? colors.brand600 : colors.line }} />
        ))}
      </View>
      {error ? <Banner>{error}</Banner> : null}

      {step === 0 && (
        <>
          <FormField control={control} name="companyName" label="Company name" required />
          <FormField control={control} name="ownerName" label="Owner name" autoComplete="name" required />
          <FormField control={control} name="phone" label="Mobile number" prefix="+91" keyboardType="phone-pad" required />
          <FormField control={control} name="email" label="Email" keyboardType="email-address" autoCapitalize="none" required />
          <FormField control={control} name="password" label="Password" password hint="8+ characters, upper & lower case, a number" required />
          <FormField control={control} name="confirmPassword" label="Confirm password" password required />
        </>
      )}
      {step === 1 && (
        <>
          <FormField control={control} name="panNumber" label="PAN number" autoCapitalize="characters" maxLength={10} placeholder="ABCDE1234F" required />
          <FormField control={control} name="gstNumber" label="GST number" autoCapitalize="characters" maxLength={15} hint="Optional if not GST-registered" />
          <FormField control={control} name="address" label="Business address" multiline style={{ paddingTop: 14 }} required />
          <FormField control={control} name="city" label="City" required />
          <FormField control={control} name="state" label="State" required />
          <FormField control={control} name="pincode" label="PIN code" keyboardType="number-pad" maxLength={6} required />
        </>
      )}
      {step === 2 && (
        <>
          <RegistrationOtp phone={phone} verified={Boolean(token)} onVerified={setToken} />
          <Controller
            control={control}
            name="acceptTerms"
            render={({ field, fieldState }) => (
              <View>
                <Pressable
                  onPress={() => field.onChange(!field.value)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: Boolean(field.value) }}
                  style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}
                >
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      borderWidth: 2,
                      borderColor: field.value ? colors.brand600 : colors.line,
                      backgroundColor: field.value ? colors.brand600 : colors.white,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {field.value ? <Text style={{ color: colors.white, fontWeight: '800' }}>✓</Text> : null}
                  </View>
                  <Text style={{ flex: 1, color: colors.ink, lineHeight: 20 }}>I agree to the Terms and Conditions and confirm the business details are accurate.</Text>
                </Pressable>
                {fieldState.error ? <Text style={{ color: colors.danger, marginTop: 6 }}>{fieldState.error.message}</Text> : null}
              </View>
            )}
          />
          <View style={{ marginTop: 16 }}>
            <Banner tone="info">Our team verifies GST/PAN details after you submit. You can sign in and check the status meanwhile.</Banner>
          </View>
        </>
      )}
    </Screen>
  );
}
