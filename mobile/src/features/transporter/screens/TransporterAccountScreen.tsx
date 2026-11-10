import { Text } from 'react-native';
import { useAuth } from '@/features/auth/context/AuthContext';
import { AccountScreen } from '@/features/account/components/AccountScreen';
import { Card, Pill, SectionTitle, Banner } from '@/components/ui';
import { toneFor } from '@/utils/status';
import { humanize } from '@/utils/format';
import { colors } from '@/theme';
import { useQuery } from '@/hooks';
import { ENDPOINTS } from '@/services/api';

type Tk = { id: string; registrationNumber: string; capacityKl: number; status: string; verificationStatus: string; assignedDriver: { name: string } | null };
type Dr = { id: string; fullName: string; phone: string; verificationStatus: string; accountStatus: string };

/** Fleet and drivers at a glance; adding and editing them, documents and finance stay on the web portal. */
export default function TransporterAccountScreen() {
  const { user } = useAuth();
  const tankers = useQuery<{ items: Tk[] }>(ENDPOINTS.transporter.tankers);
  const drivers = useQuery<{ items: Dr[] }>(ENDPOINTS.transporter.drivers);
  return (
    <AccountScreen
      org={user?.agency?.companyName}
      extra={
        <>
          <SectionTitle>My fleet ({tankers.data?.items.length ?? 0})</SectionTitle>
          {tankers.data?.items.map((t) => (
            <Card key={t.id}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>{t.registrationNumber} · {t.capacityKl} KL</Text>
              <Text style={{ color: colors.muted }}>{t.assignedDriver?.name ?? 'No driver'}</Text>
              <Pill label={`${humanize(t.status)} · ${humanize(t.verificationStatus)}`} tone={toneFor(t.verificationStatus)} />
            </Card>
          ))}
          <SectionTitle>Drivers ({drivers.data?.items.length ?? 0})</SectionTitle>
          {drivers.data?.items.map((d) => (
            <Card key={d.id}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>{d.fullName} · {d.phone}</Text>
              <Pill label={`${humanize(d.verificationStatus)} · login ${humanize(d.accountStatus)}`} tone={toneFor(d.verificationStatus)} />
            </Card>
          ))}
          <Banner tone="info">Add tankers and drivers, upload documents and see earnings on the web portal.</Banner>
        </>
      }
    />
  );
}
