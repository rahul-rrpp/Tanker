import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Alert, View } from 'react-native';
import { useAuth } from '@/features/auth/context/AuthContext';
import { stopTripTracking } from '@/features/driver/services/locationTracking';
import { ROLE_LABELS } from '@/constants/roles';
import { Avatar, ManifestTable, MenuGroup, MenuRow, T } from '@/components/ui';
import { Page } from '@/components/layout';
import { ROUTES } from '@/navigation/routes';

/** Account tab: who is signed in, shortcuts, and sign-out (which also stops any trip tracking). */
export function AccountScreen({ org, extra }: { org?: string | null; extra?: ReactNode }) {
  const { user, signOut } = useAuth();
  const router = useRouter();
  if (!user) return null;
  const out = (allDevices: boolean) =>
    Alert.alert('Sign out', allDevices ? 'Sign out on every device?' : 'Sign out of OnlyTanker?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await stopTripTracking().catch(() => undefined);
          await signOut({ allDevices });
        },
      },
    ]);
  const roles = user.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ');
  return (
    <Page title="Account">
      {/* Identity: who is signed in, for which organisation, in what role. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 8 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <T v="eyebrow" c="muted">{roles}</T>
          <T v="heading" style={{ fontSize: 24, lineHeight: 28 }}>{user.fullName}</T>
          {org ? <T v="label" c="muted">{org}</T> : null}
        </View>
        <Avatar name={user.fullName} size={56} />
      </View>
      <ManifestTable
        items={[
          { label: 'Mobile', value: user.phone, mono: true },
          { label: 'Email', value: user.email ?? 'Not added' },
        ]}
      />
      {extra}
      <MenuGroup title="Settings">
        <MenuRow icon="notifications-outline" label="Notifications" detail="Bookings, offers and trips" onPress={() => router.push(ROUTES.notifications)} />
        <MenuRow icon="shield-checkmark-outline" label="Security and devices" detail="Signed-in phones and browsers" onPress={() => router.push(ROUTES.profile)} last />
      </MenuGroup>
      <MenuGroup>
        <MenuRow icon="log-out-outline" label="Sign out" tone="neutral" onPress={() => out(false)} />
        <MenuRow icon="power-outline" label="Sign out on all devices" tone="danger" onPress={() => out(true)} last />
      </MenuGroup>
    </Page>
  );
}
