import { useAuth } from '@/features/auth/context/AuthContext';
import { AccountScreen } from '@/features/account/components/AccountScreen';
import { Button, InfoCard, InfoCardSkeleton } from '@/components/ui';
import { callPhone } from '@/utils/linking';
import { day, humanize } from '@/utils/format';
import { useQuery } from '@/hooks';
import { ENDPOINTS } from '@/services/api';

type Me = { driver: { licenceNumber: string; licenceType: string; licenceExpiry: string; hazardousTraining: string; verificationStatus: string; transporter: string; transporterPhone: string } };

export default function DriverAccountScreen() {
  const { user } = useAuth();
  const q = useQuery<Me>(ENDPOINTS.driver.me);
  const d = q.data?.driver;
  return (
    <AccountScreen
      org={user?.agency?.companyName ?? d?.transporter}
      extra={d ? (
        <InfoCard
          title="Licence"
          items={[
            { icon: 'card-outline', label: 'Licence', value: `${d.licenceNumber} (${d.licenceType})` },
            { icon: 'calendar-outline', label: 'Expiry', value: day(d.licenceExpiry) },
            { icon: 'flame-outline', label: 'Hazardous goods', value: humanize(d.hazardousTraining) },
            { icon: 'shield-checkmark-outline', label: 'Verification', value: humanize(d.verificationStatus) },
          ]}
          footer={<Button title="Call my transporter" icon="call-outline" variant="secondary" onPress={() => callPhone(d.transporterPhone)} />}
        />
      ) : q.loading ? <InfoCardSkeleton /> : null}
    />
  );
}
