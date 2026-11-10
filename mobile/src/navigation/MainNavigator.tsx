import { Stack } from 'expo-router';
import { colors } from '@/theme';

/** Signed-in area. Access is enforced by the root auth gate and, authoritatively, by the backend. */
export default function MainNavigator() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />;
}
