import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { api, parseApiError } from '@/api/client';
import { FormField } from '@/components/FormField';
import { OtpCodeInput } from '@/components/OtpCodeInput';
import { useCountdown } from '@/components/RegistrationOtp';
import { Banner, Button, Heading, Screen } from '@/components/ui';
import { useBackHandler } from '@/lib/useBackHandler';
import { forgotSchema, resetSchema } from '@/lib/validation';

export default function ForgotPassword() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Android back on the code stage returns to the identifier stage.
  useBackHandler(
    useCallback(() => {
      if (identifier && !done) {
        setIdentifier(null);
        return true;
      }
      return false;
    }, [identifier, done]),
  );

  if (done) {
    return (
      <Screen>
        <Heading title="Password updated" subtitle="You've been signed out of all devices. Sign in with your new password." />
        <Button title="Go to sign in" onPress={() => router.replace('/login')} />
      </Screen>
    );
  }
  return identifier ? <ResetStage identifier={identifier} onDone={() => setDone(true)} /> : <RequestStage onSent={setIdentifier} />;
}

function RequestStage({ onSent }: { onSent: (identifier: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<z.infer<typeof forgotSchema>>({ resolver: zodResolver(forgotSchema) });
  const submit = handleSubmit(async ({ identifier }) => {
    setError(null);
    try {
      await api.post('/auth/forgot-password', { identifier });
      onSent(identifier);
    } catch (e) {
      setError(parseApiError(e).message);
    }
  });
  return (
    <Screen>
      <Heading title="Forgot password" subtitle="Enter your registered mobile number or email to receive a reset code." />
      {error ? <Banner>{error}</Banner> : null}
      <FormField control={control} name="identifier" label="Mobile number or email" autoCapitalize="none" keyboardType="email-address" required />
      <Button title="Send reset code" onPress={submit} loading={formState.isSubmitting} />
    </Screen>
  );
}

function ResetStage({ identifier, onDone }: { identifier: string; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cooldown = useCountdown();
  const { control, handleSubmit, formState } = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) });
  const submit = handleSubmit(async (values) => {
    setError(null);
    if (code.length !== 6) return setError('Enter the 6-digit code');
    try {
      await api.post('/auth/reset-password', { identifier, code, ...values });
      onDone();
    } catch (e) {
      setError(parseApiError(e).message);
      setCode('');
    }
  });
  async function resend() {
    try {
      const { data } = await api.post('/auth/forgot-password', { identifier });
      cooldown.start(data.data.resendAfterSeconds);
    } catch (e) {
      setError(parseApiError(e).message);
    }
  }
  return (
    <Screen>
      <Heading title="Set a new password" subtitle={`If an account exists for ${identifier}, we've sent it a 6-digit code.`} />
      {error ? <Banner>{error}</Banner> : null}
      <OtpCodeInput value={code} onChange={setCode} error={Boolean(error)} />
      <Button title={cooldown.remaining > 0 ? `Resend in ${cooldown.remaining}s` : 'Resend code'} variant="ghost" onPress={resend} disabled={cooldown.remaining > 0} style={{ marginVertical: 8 }} />
      <FormField control={control} name="password" label="New password" password hint="8+ characters, upper & lower case, a number" required />
      <FormField control={control} name="confirmPassword" label="Confirm new password" password required />
      <Button title="Update password" onPress={submit} loading={formState.isSubmitting} />
    </Screen>
  );
}
