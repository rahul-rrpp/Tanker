import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { parseApiError } from '@/services/api';
import { useAuth } from '@/features/auth/context/AuthContext';
import { Bone, Avatar, Banner, Card, IconBadge, InfoCard, MenuGroup, MenuRow, SectionTitle } from '@/components/ui';
import { Page } from '@/components/layout';
import { colors } from '@/theme';
import { ROLE_LABELS, STATUS_LABELS } from '@/constants/roles';
import { useExitOnBack } from '@/hooks';
import { authService } from '@/features/auth/services/authService';

interface Session {
  id: string;
  clientType: 'WEB' | 'MOBILE';
  deviceInfo: string | null;
  createdAt: string;
  current: boolean;
}

export default function ProfileScreen() {
  const { user, reload, signOut } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useExitOnBack();

  const load = useCallback(async () => {
    setError(null);
    try {
      await reload();
      const { data } = await authService.sessions();
      setSessions(data.data.sessions);
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setLoaded(true);
    }
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function revoke(id: string) {
    try {
      await authService.revokeSession(id);
      await load();
    } catch (e) {
      setError(parseApiError(e).message);
    }
  }

  function confirmLogoutAll() {
    Alert.alert('Sign out everywhere?', 'You will be signed out on all phones and browsers, including this one.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out all', style: 'destructive', onPress: () => void signOut({ allDevices: true }) },
    ]);
  }

  if (!user) return null;

  return (
    <Page
      title="Security and devices"
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
    >
      <Card style={{ alignItems: 'center', paddingVertical: 22, gap: 6 }}>
        <Avatar name={user.fullName} size={72} />
        <Text style={{ fontSize: 20, fontWeight: '800', marginTop: 8, color: colors.ink }}>{user.fullName}</Text>
        <Text style={{ color: colors.muted }}>{user.roles.map((r) => ROLE_LABELS[r]).join(', ')}</Text>
      </Card>

      {error ? <Banner>{error}</Banner> : null}

      <InfoCard
        title="Account"
        items={[
          { icon: 'call-outline', label: 'Mobile', value: `+91 ${user.phone}` },
          { icon: 'mail-outline', label: 'Email', value: user.email ? `${user.email}${user.isEmailVerified ? '' : ' (unverified)'}` : '—' },
          user.agency ? { icon: 'business-outline', label: 'Agency', value: user.agency.companyName } : null,
          user.driverVerificationStatus ? { icon: 'shield-checkmark-outline', label: 'Driver status', value: STATUS_LABELS[user.driverVerificationStatus] } : null,
        ]}
      />

      <SectionTitle>Signed-in devices</SectionTitle>
      <Card style={{ paddingVertical: 4 }}>
        {!loaded
          ? [0, 1].map((i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12, borderBottomWidth: i === 1 ? 0 : 1, borderBottomColor: colors.lineSoft }} accessibilityLabel="Loading">
                <Bone w={38} h={38} r={12} />
                <View style={{ flex: 1, gap: 7 }}><Bone w="55%" h={13} /><Bone w="35%" h={10} /></View>
                <Bone w={56} h={12} />
              </View>
            ))
          : null}
        {sessions.map((s, i) => (
          <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12, borderBottomWidth: i === sessions.length - 1 ? 0 : 1, borderBottomColor: colors.lineSoft }}>
            <IconBadge icon={s.clientType === 'MOBILE' ? 'phone-portrait-outline' : 'desktop-outline'} tone={s.current ? 'success' : 'brand'} size={38} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: colors.ink }} numberOfLines={1}>
                {s.deviceInfo ?? (s.clientType === 'MOBILE' ? 'Mobile app' : 'Web browser')}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Since {new Date(s.createdAt).toLocaleDateString()}</Text>
            </View>
            {s.current ? (
              <Text style={{ color: colors.success, fontWeight: '700', fontSize: 12 }}>This device</Text>
            ) : (
              <Text onPress={() => revoke(s.id)} style={{ color: colors.danger, fontWeight: '700' }} accessibilityRole="button">
                Revoke
              </Text>
            )}
          </View>
        ))}
      </Card>

      <MenuGroup>
        <MenuRow icon="log-out-outline" label="Sign out" tone="neutral" onPress={() => signOut()} />
        <MenuRow icon="power-outline" label="Sign out of all devices" tone="danger" onPress={confirmLogoutAll} last />
      </MenuGroup>
    </Page>
  );
}
