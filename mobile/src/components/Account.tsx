import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Alert, Text } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { stopTripTracking } from '../driver/location';
import { ROLE_LABELS } from '../lib/types';
import { Card, Page, Row, SectionTitle } from './kit';
import { Button } from './ui';

/** Account tab: who is signed in, shortcuts, and sign-out (which also stops any trip tracking). */
export function AccountScreen({ org, extra }: { org?: string | null; extra?: ReactNode }) {
  const { user, signOut } = useAuth();
  const router = useRouter();
  if (!user) return null;
  const out = (allDevices: boolean) =>
    Alert.alert('Sign out', allDevices ? 'Sign out on every device?' : 'Sign out of TankerLink?', [
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
  return (
    <Page title="Account">
      <Card>
        <Text style={{ fontSize: 18, fontWeight: '700' }}>{user.fullName}</Text>
        <Row label="Role" value={user.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ')} />
        {org ? <Row label="Organisation" value={org} /> : null}
        <Row label="Mobile" value={user.phone} />
        <Row label="Email" value={user.email} />
      </Card>
      {extra}
      <SectionTitle>More</SectionTitle>
      <Button title="Notifications" variant="secondary" onPress={() => router.push('/notifications')} />
      <Button title="Security and devices" variant="secondary" onPress={() => router.push('/profile')} />
      <Button title="Sign out" variant="ghost" onPress={() => out(false)} />
      <Button title="Sign out on all devices" variant="danger" onPress={() => out(true)} />
    </Page>
  );
}
