import { Stack } from 'expo-router';
import { colors } from '@/lib/theme';

/** Signed-in area. Access is enforced by the root auth gate and, authoritatively, by the backend. */
export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />;
}
