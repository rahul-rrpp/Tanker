import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/server-auth';

export default async function Home() {
  const session = await getCurrentUser();
  redirect(session ? session.redirectTo : '/login');
}
