import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Logo, Button } from '@/components/ui';
import { colors } from '@/theme';
import { ROUTES } from '@/navigation/routes';

const POINTS = ['Trips and deliveries in one place', 'Sign in with your mobile number', 'Verified agencies and drivers'];

export default function WelcomeScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.hero}>
        <Logo inverted size={64} />
        <Text style={styles.headline}>Every tanker.{'\n'}Every trip.</Text>
        {POINTS.map((p) => (
          <Text key={p} style={styles.point}>
            <Text style={{ color: colors.accentLight }}>●</Text>  {p}
          </Text>
        ))}
      </View>
      <View style={styles.actions}>
        <Button title="Sign in" onPress={() => router.push(ROUTES.login)} />
        <Button title="Create an account" variant="secondary" onPress={() => router.push(ROUTES.signup)} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.brand900 },
  hero: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  headline: { color: colors.white, fontSize: 34, fontWeight: '800', marginTop: 32, marginBottom: 24, lineHeight: 40, letterSpacing: -0.5 },
  point: { color: colors.brand100, fontSize: 16, marginBottom: 12 },
  actions: { padding: 20, gap: 12, backgroundColor: colors.canvas, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
});
