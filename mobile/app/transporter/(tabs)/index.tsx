import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { Card, Page, Pill, QueryState, SectionTitle, Stats, toneFor } from '@/components/kit';
import { Banner } from '@/components/ui';
import { dateTime, humanize, inr } from '@/lib/format';
import { colors } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';

type Dash = { verificationStatus: string; cards: Record<string, number>; activeTrips: { id: string; tripCode: string; status: string; etaAt: string | null; pickup?: string; delivery?: string; tanker: { registrationNumber: string } | null }[]; alerts: { subject: string; detail: string }[] };

export default function TransporterHome() {
  const { user } = useAuth();
  const router = useRouter();
  const q = useQuery<Dash>('/transporters/dashboard', { pollMs: 60_000 });
  const c = q.data?.cards;
  return (
    <Page title={user?.agency?.companyName ?? 'Transporter'} subtitle="Transporter" refreshing={q.refreshing} onRefresh={q.refresh}>
      {q.data && q.data.verificationStatus !== 'APPROVED' ? <Banner tone="warning">Verification pending. Complete your documents and fleet on the web portal. Bidding opens once verified.</Banner> : null}
      <QueryState loading={q.loading} error={q.error} onRetry={q.reload} />
      {c ? <Stats items={[{ label: 'New booking requests', value: c.newBookingRequests, icon: 'search-outline' }, { label: 'Pending offers', value: c.pendingOffers, icon: 'pricetags-outline' }, { label: 'Confirmed bookings', value: c.confirmedBookings, icon: 'checkmark-circle-outline' }, { label: 'Active trips', value: c.activeTrips, icon: 'navigate-outline' }, { label: 'Available tankers', value: `${c.availableTankers}/${c.totalTankers}`, icon: 'bus-outline' }, { label: 'Active drivers', value: c.activeDrivers, icon: 'people-outline' }, { label: "This month's freight", value: inr(c.monthlyFreight), icon: 'cash-outline' }, { label: 'Pending settlements', value: inr(c.pendingSettlements), icon: 'time-outline' }]} /> : null}
      {q.data?.activeTrips.length ? <SectionTitle>Active trips</SectionTitle> : null}
      {q.data?.activeTrips.map((t) => (
        <Card key={t.id} onPress={() => router.push(`/transporter/trip/${t.id}`)}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>{t.pickup} → {t.delivery}</Text>
          <Text style={{ color: colors.muted }}>{t.tripCode} · {t.tanker?.registrationNumber ?? 'No tanker'}{t.etaAt ? ` · ETA ${dateTime(t.etaAt)}` : ''}</Text>
          <Pill label={humanize(t.status)} tone={toneFor(t.status)} />
        </Card>
      ))}
      {q.data?.alerts.length ? <SectionTitle>Document and driver alerts</SectionTitle> : null}
      {q.data?.alerts.slice(0, 6).map((a, i) => <Text key={i} style={{ color: colors.warning }}>⚠ {a.subject}: {a.detail}</Text>)}
    </Page>
  );
}
