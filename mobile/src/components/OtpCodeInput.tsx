import { useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius } from '../lib/theme';

/**
 * One hidden TextInput drives six visual boxes — supports SMS autofill
 * (textContentType="oneTimeCode" on iOS, autoComplete="sms-otp" on Android) and paste.
 */
export function OtpCodeInput({ value, onChange, length = 6, error, autoFocus = true }: { value: string; onChange: (v: string) => void; length?: number; error?: boolean; autoFocus?: boolean }) {
  const ref = useRef<TextInput>(null);
  return (
    <Pressable onPress={() => ref.current?.focus()} accessibilityLabel="Verification code input" accessibilityHint={`Enter the ${length}-digit code`}>
      <View style={styles.row}>
        {Array.from({ length }).map((_, i) => {
          const active = i === Math.min(value.length, length - 1);
          return (
            <View key={i} style={[styles.box, active && styles.active, error && styles.error]}>
              <Text style={styles.digit}>{value[i] ?? ''}</Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        autoFocus={autoFocus}
        style={styles.hidden}
        accessibilityLabel="Verification code"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  box: {
    flex: 1,
    maxWidth: 52,
    height: 56,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  active: { borderColor: colors.brand500, borderWidth: 2 },
  error: { borderColor: colors.danger },
  digit: { fontSize: 22, fontWeight: '700', color: colors.ink },
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});
