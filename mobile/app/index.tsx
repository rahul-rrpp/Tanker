import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui';
import { colors } from '@/lib/theme';

/**
 * Splash / auth-loading screen. Shown while the stored session is restored; the root gate then
 * redirects. If the server is unreachable the session is kept and the user can retry.
 */
export default function SplashRoute() {
  const { status, error, retry } = useAuth();
  return (
    <View style={styles.container}>
      <Logo inverted size={72} />
      <Text style={styles.tagline}>Tanker Transport Management</Text>
      {status === 'offline' ? (
        <View style={styles.offline}>
          <Text style={styles.offlineText}>{error ?? 'Unable to connect.'}</Text>
          <Button title="Try again" variant="secondary" onPress={retry} />
        </View>
      ) : (
        <ActivityIndicator color={colors.accentLight} style={{ marginTop: 40 }} accessibilityLabel="Restoring your session" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.brand900, alignItems: 'center', justifyContent: 'center', padding: 24 },
  tagline: { color: colors.brand100, marginTop: 12, fontSize: 15, letterSpacing: 0.5 },
  offline: { marginTop: 40, width: '100%', gap: 16 },
  offlineText: { color: '#fff', textAlign: 'center', fontSize: 15, lineHeight: 22 },
});
