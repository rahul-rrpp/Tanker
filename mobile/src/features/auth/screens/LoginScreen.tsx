import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Text, View } from 'react-native';
import type { z } from 'zod';
import { parseApiError } from '@/services/api';
import { useAuth } from '@/features/auth/context/AuthContext';
import { FormField } from '@/components/forms';
import { Chips, Banner, Button, Field, LinkText } from '@/components/ui';
import { Heading, Screen } from '@/components/layout';
import { colors } from '@/theme';
import { loginSchema } from '@/features/auth/validation/schemas';
import { authService } from '../services/authService';
import { ROUTES } from '@/navigation/routes';

/** Password sign-in for everyone; one-time code sign-in for drivers (who have no password) and anyone else. */
export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [mode, setMode] = useState<'password' | 'otp'>('password');
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<{ devCode?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      const { data } = await authService.login(values);
      await signIn(data.data); // the root gate navigates to the right home screen
    } catch (e) {
      const err = parseApiError(e);
      setError(err.code === 'ACCOUNT_LOCKED' ? `${err.message} Try again later or reset your password.` : err.message);
    }
  });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  const sendCode = () => run(async () => {
    const { data } = await authService.sendLoginCode(phone.trim());
    setSent({ devCode: data.data.devCode });
  });
  const verify = () => run(async () => {
    const { data } = await authService.verifyLoginCode(phone.trim(), code.trim());
    await signIn(data.data);
  });

  return (
    <Screen>
      <Heading title="Sign in" subtitle="For companies, transporters and drivers." />
      <View style={{ marginBottom: 16 }}>
        <Chips value={mode} options={[{ value: 'password', label: 'Password' }, { value: 'otp', label: 'One-time code' }]} onChange={(v) => { setMode(v); setError(null); }} />
      </View>
      {error ? <Banner>{error}</Banner> : null}
      {mode === 'password' ? (
        <>
          <FormField control={control} name="identifier" label="Mobile number or email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="username" required />
          <FormField control={control} name="password" label="Password" password autoComplete="password" returnKeyType="go" onSubmitEditing={submit} required />
          <View style={{ alignItems: 'flex-end', marginTop: -4, marginBottom: 20 }}>
            <LinkText onPress={() => router.push(ROUTES.forgotPassword)}>Forgot password?</LinkText>
          </View>
          <Button title="Sign in" onPress={submit} loading={formState.isSubmitting} />
        </>
      ) : (
        <>
          <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={10} autoComplete="tel" required />
          {sent ? (
            <>
              {sent.devCode ? <Banner tone="info">{`Development code: ${sent.devCode}`}</Banner> : null}
              <Field label="Code from SMS" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={8} required />
              <Button title="Verify and sign in" onPress={() => void verify()} loading={busy} disabled={code.trim().length < 4} />
              <View style={{ marginTop: 12 }}><Button title="Send a new code" variant="ghost" onPress={() => void sendCode()} /></View>
            </>
          ) : (
            <Button title="Send code" onPress={() => void sendCode()} loading={busy} disabled={!/^\d{10}$/.test(phone.trim())} />
          )}
          <Text style={{ color: colors.muted, marginTop: 12, fontSize: 13 }}>Drivers: your transporter adds your number. Sign in here with the code we text you.</Text>
        </>
      )}
      <Text style={{ textAlign: 'center', marginTop: 24, color: colors.muted }}>
        New to TankerLink? <LinkText onPress={() => router.push(ROUTES.signup)}>Create an account</LinkText>
      </Text>
    </Screen>
  );
}
