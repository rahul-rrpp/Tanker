import { useCallback, useState, type ReactNode } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { View } from 'react-native';
import { Heading, Screen } from '@/components/layout';
import { Banner, Button } from '@/components/ui';
import { useBackHandler } from '@/hooks';
import { parseApiError } from '@/services/api';
import { useAuth } from '../context/AuthContext';
import { authService } from '../services/authService';
import { RegistrationOtp } from './RegistrationOtp';

/** Details form → phone OTP → submit. Shared by driver and customer signup. */
export function TwoPhaseSignup<T extends FieldValues>({
  title,
  subtitle,
  form,
  endpoint,
  toPayload,
  children,
}: {
  title: string;
  subtitle: string;
  form: UseFormReturn<T>;
  endpoint: string;
  toPayload: (v: T) => Record<string, unknown>;
  children: ReactNode;
}) {
  const { signIn } = useAuth();
  const [details, setDetails] = useState<Record<string, unknown> | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useBackHandler(
    useCallback(() => {
      if (details && !submitting) {
        setDetails(null);
        setToken(null);
        return true;
      }
      return false;
    }, [details, submitting]),
  );

  const toVerify = form.handleSubmit((v) => {
    setError(null);
    setDetails(toPayload(v));
  });

  async function submit() {
    if (!details || !token) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await authService.register(endpoint, { ...details, phoneVerificationToken: token });
      await signIn(data.data);
    } catch (e) {
      const err = parseApiError(e);
      err.fields.forEach((f) => form.setError(f.field as never, { message: f.message }));
      if (err.fields.length || err.code?.endsWith('ALREADY_REGISTERED') || err.code === 'INVALID_INVITATION' || err.code === 'CONFLICT') setDetails(null);
      if (err.code === 'INVALID_VERIFICATION_TOKEN') setToken(null);
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <Screen
      footer={
        details ? (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Button title="Edit" variant="secondary" onPress={() => setDetails(null)} style={{ flex: 1 }} disabled={submitting} />
            <Button title="Create account" onPress={submit} loading={submitting} disabled={!token} style={{ flex: 2 }} />
          </View>
        ) : (
          <Button title="Continue to verification" onPress={toVerify} />
        )
      }
    >
      <Heading title={title} subtitle={details ? 'Last step: verify your mobile number.' : subtitle} />
      {error ? <Banner>{error}</Banner> : null}
      {details ? <RegistrationOtp phone={String(details.phone)} verified={Boolean(token)} onVerified={setToken} /> : children}
    </Screen>
  );
}
