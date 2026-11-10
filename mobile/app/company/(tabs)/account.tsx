import { useAuth } from '@/auth/AuthContext';
import { AccountScreen } from '@/components/Account';
import { Banner } from '@/components/ui';

export default function Account() {
  const { user } = useAuth();
  return <AccountScreen org={user?.company ? `${user.company.name} (${user.company.companyCode})` : null} extra={<Banner tone="info">Payments, invoices, reports and saved locations are on the web portal.</Banner>} />;
}
