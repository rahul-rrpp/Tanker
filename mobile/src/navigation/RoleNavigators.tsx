import { Ionicons } from '@expo/vector-icons';
import { Stack, Tabs } from 'expo-router';
import { colors } from '@/theme';
import { COMPANY_TABS, DRIVER_TABS, TRANSPORTER_TABS, type TabDef } from './routes';

/** Bottom tab bar shared by the three role apps. */
export function RoleTabs({ tabs }: { tabs: readonly TabDef[] }) {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.brand600, tabBarInactiveTintColor: colors.muted, tabBarLabelStyle: { fontSize: 11, fontWeight: '600' } }}>
      {tabs.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.title, tabBarIcon: ({ color, size }) => <Ionicons name={t.icon} color={color} size={size} /> }} />
      ))}
    </Tabs>
  );
}

/** Stack around the tabs: detail screens get a native header with a back button. */
export function RoleStack() {
  return (
    <Stack screenOptions={{ headerTintColor: colors.brand600, headerTitleStyle: { color: colors.ink, fontWeight: '700' }, contentStyle: { backgroundColor: colors.canvas }, headerBackTitle: 'Back' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}

export function CompanyTabs() {
  return <RoleTabs tabs={COMPANY_TABS} />;
}

export function TransporterTabs() {
  return <RoleTabs tabs={TRANSPORTER_TABS} />;
}

export function DriverTabs() {
  return <RoleTabs tabs={DRIVER_TABS} />;
}
