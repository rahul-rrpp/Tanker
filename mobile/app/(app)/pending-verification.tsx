import { Redirect } from 'expo-router';
import { homeRouteFor, useAuth } from '@/auth/AuthContext';

/**
 * Kept for old deep links. Company, transporter and driver apps now show their own verification state,
 * so this route simply forwards to the right home screen.
 */
export default function PendingVerification() {
  const { user } = useAuth();
  return <Redirect href={user ? homeRouteFor(user) : '/welcome'} />;
}
