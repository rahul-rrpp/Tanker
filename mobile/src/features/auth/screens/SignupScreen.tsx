import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Linking, Pressable, Text, View } from 'react-native';
import { Banner, IconBadge, LinkText } from '@/components/ui';
import { Heading, Screen } from '@/components/layout';
import { colors, pageStyles as s } from '@/theme';
import type { IconName } from '@/types';
import { ROUTES } from '@/navigation/routes';

/** Company and transporter registration collects GST/PAN and verifies mobile and email, so it runs on the web. */
const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? 'http://10.0.2.2:3000').replace(/\/$/, '');

function Choice({ icon, title, text, onPress, tone }: { icon: IconName; title: string; text: string; onPress: () => void; tone: 'brand' | 'accent' }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [s.card, { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18 }, pressed && { opacity: 0.85 }]}>
      <IconBadge icon={icon} tone={tone} size={48} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: '800', color: colors.ink }}>{title}</Text>
        <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>{text}</Text>
      </View>
      <Ionicons name="open-outline" size={18} color={colors.muted} />
    </Pressable>
  );
}

export default function SignupScreen() {
  const router = useRouter();
  return (
    <Screen>
      <Heading title="Create an account" subtitle="Choose how you use OnlyTanker. Registration opens on the web." />
      <View style={{ gap: 12 }}>
        <Choice icon="business-outline" tone="brand" title="I need tankers" text="Register my company to book tankers" onPress={() => void Linking.openURL(`${WEB_URL}/register`)} />
        <Choice icon="bus-outline" tone="accent" title="I own tankers" text="Register my transport business" onPress={() => void Linking.openURL(`${WEB_URL}/register/transporter`)} />
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
