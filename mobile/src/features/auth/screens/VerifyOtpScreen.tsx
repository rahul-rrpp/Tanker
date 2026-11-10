import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { parseApiError } from '@/services/api';
import { useAuth } from '@/features/auth/context/AuthContext';
import { OtpCodeInput } from '@/components/forms';
import { useCountdown } from '@/hooks';
import { Banner, Button } from '@/components/ui';
import { Heading, Screen } from '@/components/layout';
import { colors } from '@/theme';
import { authService } from '../services/authService';

/** OTP verification for mobile-number login. */
export default function VerifyOtpScreen() {
  const { phone, cooldown: initialCooldown } = useLocalSearchParams<{ phone: string; cooldown?: string }>();
  const { signIn } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const cooldown = useCountdown();

  useEffect(() => {
    cooldown.start(Number(initialCooldown) || 45);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!phone) return <Redirect href="/login" />;

  async function verify(value: string) {
    if (value.length !== 6 || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      const { data } = await authService.verifyLoginCode(phone, value);
      await signIn(data.data);
    } catch (e) {
      const err = parseApiError(e);
      const left = (err.details as { attemptsRemaining?: number } | undefined)?.attemptsRemaining;
      setError(left !== undefined ? `${err.message}. ${left} attempt(s) left.` : err.message);
      setCode('');
      setVerifying(false);
    }
  }

  async function resend() {
    setError(null);
    setInfo(null);
    try {
      const { data } = await authService.sendLoginCode(phone);
      cooldown.start(data.data.resendAfterSeconds);
      setInfo('A new code has been sent.');
    } catch (e) {
      const err = parseApiError(e);
      setError(err.message);
      const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      if (retry) cooldown.start(retry);
    }
  }

  return (
    <Screen>
      <Heading title="Enter the code" subtitle={`If +91 ••••••${phone.slice(-4)} is registered, a 6-digit code is on its way. It expires in 5 minutes.`} />
      {error ? <Banner>{error}</Banner> : null}
      {info && !error ? <Banner tone="success">{info}</Banner> : null}
      <OtpCodeInput
        value={code}
        onChange={(v) => {
          setCode(v);
          if (v.length === 6) void verify(v);
        }}
        error={Boolean(error)}
      />
      <Button title="Verify & sign in" onPress={() => verify(code)} loading={verifying} disabled={code.length !== 6} style={{ marginTop: 24 }} />
      <View style={{ alignItems: 'center', marginTop: 20 }}>
        <Text style={{ color: colors.muted }}>Didn&apos;t get it?</Text>
        <Button title={cooldown.remaining > 0 ? `Resend in ${cooldown.remaining}s` : 'Resend OTP'} variant="ghost" onPress={resend} disabled={cooldown.remaining > 0} />
      </View>
    </Screen>
  );
}
