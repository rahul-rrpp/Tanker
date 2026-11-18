import { Ionicons } from '@expo/vector-icons';
import { Stack, Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { colors, fonts } from '@/theme';
import type { IconName } from '@/types';
import { COMPANY_TABS, DRIVER_TABS, TRANSPORTER_TABS, type TabDef } from './routes';

/** Active tabs show the filled icon ("home"), inactive ones the outline ("home-outline"). */
const iconFor = (name: IconName, focused: boolean) => (focused ? (name.replace(/-outline$/, '') as IconName) : name);

/** Bottom tab bar shared by the three role apps. */
export function RoleTabs({ tabs }: { tabs: readonly TabDef[] }) {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Manifest tab bar: paper, a single hairline, ink for the current tab, faint for the rest.
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.faint,
        tabBarLabelStyle: { fontSize: 11, fontFamily: fonts.semibold, letterSpacing: 0.2 },
        tabBarStyle: { backgroundColor: colors.paper, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, elevation: 0 },
      }}
    >
      {tabs.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.title, tabBarIcon: ({ color, size, focused }) => <Ionicons name={iconFor(t.icon, focused)} color={color} size={size} /> }} />
      ))}
    </Tabs>
  );
}

/** Stack around the tabs: detail screens get a clean native header with a back button. */
export function RoleStack() {
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.ink,
        headerTitleStyle: { color: colors.ink, fontFamily: fonts.displayBold },
        headerStyle: { backgroundColor: colors.paper },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.paper },
        headerBackTitle: 'Back',
      }}
    >
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
