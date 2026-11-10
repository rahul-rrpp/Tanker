import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { Card, Page, Pill, QueryState, SectionTitle, Stats, toneFor } from '@/components/kit';
import { Banner, Button } from '@/components/ui';
import { city, humanize, inr } from '@/lib/format';
import { colors } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';

type Dash = { summary: Record<string, number | string>; recentBookings: { id: string; bookingCode: string; status: string; customerOffer: string; locations: { type: string; city: string | null }[]; product: { name: string } }[] };

export default function CompanyHome() {
  const { user } = useAuth();
  const router = useRouter();
  const q = useQuery<Dash>('/companies/dashboard');
  const c = user?.company;
  const s = q.data?.summary;
  return (
    <Page title={c?.name ?? 'Company'} subtitle={c ? `Company ID ${c.companyCode}` : undefined} refreshing={q.refreshing} onRefresh={q.refresh}>
      {c && c.status !== 'VERIFIED' ? <Banner tone="warning">{c.status === 'REJECTED' ? `Verification rejected. ${c.statusReason ?? ''}` : 'Verification pending. Bookings open once TankerLink verifies your documents.'}</Banner> : null}
      <Button title="Book a tanker" onPress={() => router.push('/company/new-booking')} disabled={c?.status !== 'VERIFIED'} />
      <QueryState loading={q.loading} error={q.error} onRetry={q.reload} />
      {s ? <Stats items={[{ label: 'Pending bookings', value: s.pendingBookings, icon: 'time-outline' }, { label: 'Offers waiting', value: s.offersReceived, icon: 'pricetags-outline' }, { label: 'Active trips', value: s.activeTrips, icon: 'navigate-outline' }, { label: 'Completed', value: s.completedTrips, icon: 'checkmark-done-outline' }, { label: 'Transport spend', value: inr(s.totalTransportExpense), icon: 'cash-outline' }, { label: 'Avg freight / trip', value: inr(s.averageFreightPerTrip), icon: 'trending-up-outline' }]} /> : null}
      {q.data?.recentBookings.length ? <SectionTitle>Recent bookings</SectionTitle> : null}
      {q.data?.recentBookings.map((b) => (
        <Card key={b.id} onPress={() => router.push(`/company/booking/${b.id}`)}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>{city(b.locations, 'PICKUP')} → {city(b.locations, 'DELIVERY')}</Text>
          <Text style={{ color: colors.muted }}>{b.bookingCode} · {b.product.name} · {inr(b.customerOffer)}</Text>
          <Pill label={humanize(b.status)} tone={toneFor(b.status)} />
        </Card>
      ))}
    </Page>
  );
}
