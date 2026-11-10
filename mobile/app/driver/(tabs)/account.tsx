import { useAuth } from '@/auth/AuthContext';
import { AccountScreen } from '@/components/Account';
import { Card, callPhone, Row } from '@/components/kit';
import { Button } from '@/components/ui';
import { day, humanize } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';

type Me = { driver: { licenceNumber: string; licenceType: string; licenceExpiry: string; hazardousTraining: string; verificationStatus: string; transporter: string; transporterPhone: string } };

export default function DriverAccount() {
  const { user } = useAuth();
  const q = useQuery<Me>('/driver/me');
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
