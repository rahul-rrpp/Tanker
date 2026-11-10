import { useState } from 'react';
import { Text, View } from 'react-native';
import { OtpCodeInput } from '@/components/forms';
import { Banner, Button } from '@/components/ui';
import { useCountdown } from '@/hooks';
import { parseApiError } from '@/services/api';
import { colors, formStyles as styles } from '@/theme';
import { authService } from '../services/authService';

/** Inline registration OTP step (shared backend endpoints /auth/otp/send + /auth/otp/verify). */
export function RegistrationOtp({ phone, verified, onVerified }: { phone: string; verified: boolean; onVerified: (token: string) => void }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const cooldown = useCountdown();

  async function send() {
    setBusy('send');
    setError(null);
    try {
      const { data } = await authService.sendRegistrationCode(phone);
      setSentTo(data.data.destination);
      setCode('');
      cooldown.start(data.data.resendAfterSeconds);
    } catch (e) {
      const err = parseApiError(e);
      setError(err.message);
      const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      if (retry) cooldown.start(retry);
    } finally {
      setBusy(null);
    }
  }

  async function verify(value: string) {
    setBusy('verify');
    setError(null);
    try {
      const { data } = await authService.verifyRegistrationCode(phone, value);
      onVerified(data.data.verificationToken);
    } catch (e) {
      const err = parseApiError(e);
      const left = (err.details as { attemptsRemaining?: number } | undefined)?.attemptsRemaining;
      setError(left !== undefined ? `${err.message}. ${left} attempt(s) left.` : err.message);
      setCode('');
      if (err.code === 'OTP_EXPIRED' || err.code === 'OTP_ATTEMPTS_EXCEEDED') setSentTo(null);
    } finally {
      setBusy(null);
    }
  }

  if (verified) return <Banner tone="success">✓ +91 {phone} verified</Banner>;

  return (
    <View style={[styles.card, { marginBottom: 16 }]}>
      <Text style={{ fontWeight: '700', fontSize: 16, color: colors.ink }}>Verify your mobile number</Text>
      <Text style={{ color: colors.muted, marginTop: 4, marginBottom: 16 }}>
        {sentTo ? `Enter the 6-digit code sent to ${sentTo}.` : `We'll send a one-time code to +91 ${phone}.`}
      </Text>
      {error ? <Banner>{error}</Banner> : null}
      {sentTo ? (
        <>
          <OtpCodeInput
            value={code}
            onChange={(v) => {
              setCode(v);
              if (v.length === 6) void verify(v);
            }}
            error={Boolean(error)}
          />
          <Button
            title={cooldown.remaining > 0 ? `Resend in ${cooldown.remaining}s` : 'Resend code'}
            variant="ghost"
            onPress={send}
            disabled={cooldown.remaining > 0}
            loading={busy === 'send'}
            style={{ marginTop: 8 }}
          />
          {busy === 'verify' ? <Text style={{ textAlign: 'center', color: colors.muted }}>Verifying…</Text> : null}
        </>
      ) : (
        <Button title={cooldown.remaining > 0 ? `Send code in ${cooldown.remaining}s` : 'Send verification code'} variant="secondary" onPress={send} loading={busy === 'send'} disabled={cooldown.remaining > 0} />
      )}
    </View>
  );
}
