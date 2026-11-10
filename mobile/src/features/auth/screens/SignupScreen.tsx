import { useRouter } from 'expo-router';
import { Linking, Text, View } from 'react-native';
import { Banner, Button, LinkText } from '@/components/ui';
import { Heading, Screen } from '@/components/layout';
import { colors } from '@/theme';
import { ROUTES } from '@/navigation/routes';

/** Company and transporter registration collects GST/PAN and verifies mobile and email, so it runs on the web. */
const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? 'http://10.0.2.2:3000').replace(/\/$/, '');

export default function SignupScreen() {
  const router = useRouter();
  return (
    <Screen>
      <Heading title="Create an account" subtitle="Choose how you use TankerLink." />
      <View style={{ gap: 12 }}>
        <Button title="Register my company (book tankers)" onPress={() => void Linking.openURL(`${WEB_URL}/register`)} />
        <Button title="Register my transport business" variant="secondary" onPress={() => void Linking.openURL(`${WEB_URL}/register/transporter`)} />
      </View>
      <View style={{ marginTop: 20 }}>
        <Banner tone="info">Drivers do not register themselves. Your transporter adds your mobile number, then you sign in with a one-time code.</Banner>
      </View>
      <Text style={{ textAlign: 'center', marginTop: 24, color: colors.muted }}>
        Already registered? <LinkText onPress={() => router.replace(ROUTES.login)}>Sign in</LinkText>
      </Text>
    </Screen>
  );
}
