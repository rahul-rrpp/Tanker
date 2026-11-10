import { useAuth } from '@/features/auth/context/AuthContext';
import { AccountScreen } from '@/features/account/components/AccountScreen';
import { Card, Row, Button } from '@/components/ui';
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
        <>
          <Card>
            <Row label="Licence" value={`${d.licenceNumber} (${d.licenceType})`} />
            <Row label="Licence expiry" value={day(d.licenceExpiry)} />
            <Row label="Hazardous goods training" value={humanize(d.hazardousTraining)} />
            <Row label="Verification" value={humanize(d.verificationStatus)} />
          </Card>
          <Button title="Call my transporter" variant="secondary" onPress={() => callPhone(d.transporterPhone)} />
        </>
      ) : null}
    />
  );
}
