import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { parseApiError } from '@/services/api';
import { useAuth } from '@/features/auth/context/AuthContext';
import { Banner, Button } from '@/components/ui';
import { formStyles as styles, colors } from '@/theme';
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
  useExitOnBack();

  const load = useCallback(async () => {
    setError(null);
    try {
      await reload();
      const { data } = await authService.sessions();
      setSessions(data.data.sessions);
    } catch (e) {
      setError(parseApiError(e).message);
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
  const initials = user.fullName
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={{ alignItems: 'center', marginVertical: 16 }}>
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.brand600, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors.white, fontSize: 28, fontWeight: '700' }}>{initials}</Text>
          </View>
          <Text style={{ fontSize: 22, fontWeight: '700', marginTop: 12, color: colors.ink }}>{user.fullName}</Text>
          <Text style={{ color: colors.muted, marginTop: 4 }}>{user.roles.map((r) => ROLE_LABELS[r]).join(', ')}</Text>
        </View>

        {error ? <Banner>{error}</Banner> : null}

        <Section title="Account">
          <Row label="Mobile" value={`+91 ${user.phone}`} />
          <Row label="Email" value={user.email ? `${user.email}${user.isEmailVerified ? '' : ' (unverified)'}` : '—'} />
          {user.agency ? <Row label="Agency" value={user.agency.companyName} /> : null}
          {user.driverVerificationStatus ? <Row label="Driver status" value={STATUS_LABELS[user.driverVerificationStatus]} /> : null}
        </Section>

        <Section title="Signed-in devices">
          {sessions.map((s) => (
            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 }}>
              <Text style={{ fontSize: 20 }}>{s.clientType === 'MOBILE' ? '📱' : '💻'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600', color: colors.ink }} numberOfLines={1}>
                  {s.deviceInfo ?? (s.clientType === 'MOBILE' ? 'Mobile app' : 'Web browser')}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Since {new Date(s.createdAt).toLocaleDateString()}</Text>
              </View>
              {s.current ? (
                <Text style={{ color: colors.success, fontWeight: '600', fontSize: 12 }}>This device</Text>
              ) : (
                <Text onPress={() => revoke(s.id)} style={{ color: colors.danger, fontWeight: '600' }} accessibilityRole="button">
                  Revoke
                </Text>
              )}
            </View>
          ))}
        </Section>

        <View style={{ gap: 10, marginTop: 8 }}>
          <Button title="Sign out" variant="secondary" onPress={() => signOut()} />
          <Button title="Sign out of all devices" variant="ghost" onPress={confirmLogoutAll} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, gap: 16 }}>
      <Text style={{ color: colors.muted }}>{label}</Text>
      <Text style={{ fontWeight: '600', color: colors.ink, flexShrink: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}
