import { useAuth } from '@/features/auth/context/AuthContext';
import { AccountScreen } from '@/features/account/components/AccountScreen';
import { Banner } from '@/components/ui';

export default function CompanyAccountScreen() {
  const { user } = useAuth();
  return <AccountScreen org={user?.company ? `${user.company.name} (${user.company.companyCode})` : null} extra={<Banner tone="info">Payments, invoices, reports and saved locations are on the web portal.</Banner>} />;
}
