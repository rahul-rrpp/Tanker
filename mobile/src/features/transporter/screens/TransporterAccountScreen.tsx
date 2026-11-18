import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { useAuth } from '@/features/auth/context/AuthContext';
import { AccountScreen } from '@/features/account/components/AccountScreen';
import { Banner, Button, Card, IconBadge, Pill, RowsSkeleton, SectionTitle } from '@/components/ui';
import { ROUTES } from '@/navigation/routes';
import { toneFor } from '@/utils/status';
import { humanize } from '@/utils/format';
import { colors } from '@/theme';
import { useQuery } from '@/hooks';
import { ENDPOINTS } from '@/services/api';

type Tk = { id: string; registrationNumber: string; capacityKl: number; status: string; verificationStatus: string; assignedDriver: { name: string } | null };
type Dr = { id: string; fullName: string; phone: string; verificationStatus: string; accountStatus: string };

/** Fleet and drivers at a glance, plus adding a driver. Tankers, documents and finance stay on the web portal. */
export default function TransporterAccountScreen() {
  const { user } = useAuth();
  const tankers = useQuery<{ items: Tk[] }>(ENDPOINTS.transporter.tankers);
  const drivers = useQuery<{ items: Dr[] }>(ENDPOINTS.transporter.drivers);
  const router = useRouter();
  return (
    <AccountScreen
      org={user?.agency?.companyName}
      extra={
        <>
          <SectionTitle>My fleet ({tankers.data?.items.length ?? 0})</SectionTitle>
          {tankers.loading ? <RowsSkeleton count={2} /> : null}
          {tankers.data?.items.map((t) => (
            <Card key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <IconBadge icon="bus-outline" tone={t.status === 'AVAILABLE' ? 'success' : 'brand'} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontWeight: '800', color: colors.ink }}>{t.registrationNumber} · {t.capacityKl} KL</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{t.assignedDriver?.name ?? 'No driver'} · {humanize(t.status)}</Text>
              </View>
              <Pill label={humanize(t.verificationStatus)} tone={toneFor(t.verificationStatus)} />
            </Card>
          ))}
          <SectionTitle>Drivers ({drivers.data?.items.length ?? 0})</SectionTitle>
          {drivers.loading ? <RowsSkeleton count={2} /> : null}
          {drivers.data?.items.map((d) => (
            <Card key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <IconBadge icon="person-outline" tone={d.accountStatus === 'ACTIVE' ? 'success' : 'neutral'} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontWeight: '800', color: colors.ink }}>{d.fullName}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{d.phone} · login {humanize(d.accountStatus)}</Text>
              </View>
              <Pill label={humanize(d.verificationStatus)} tone={toneFor(d.verificationStatus)} />
            </Card>
          ))}
          <Button title="Add driver" icon="person-add-outline" variant="secondary" onPress={() => router.push(ROUTES.transporter.addDriver)} />
          <Banner tone="info">Add tankers, upload documents and see earnings on the web portal.</Banner>
        </>
      }
    />
  );
}
