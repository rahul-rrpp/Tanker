import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { useAuth } from '@/features/auth/context/AuthContext';
import { Banner, Button, Card, IconBadge, ListCard, ListSkeleton, Pill, QuickActions, Stats } from '@/components/ui';
import { HeroPage } from '@/components/layout';
import { QueryState } from '@/components/common';
import { toneFor } from '@/utils/status';
import { dateTime, humanize, inr } from '@/utils/format';
import { colors } from '@/theme';
import { useQuery } from '@/hooks';
import { ENDPOINTS } from '@/services/api';
import { ROUTES } from '@/navigation/routes';

type Dash = { verificationStatus: string; cards: Record<string, number>; activeTrips: { id: string; tripCode: string; status: string; etaAt: string | null; pickup?: string; delivery?: string; tanker: { registrationNumber: string } | null }[]; alerts: { subject: string; detail: string }[] };

export default function TransporterHomeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const q = useQuery<Dash>(ENDPOINTS.transporter.dashboard, { pollMs: 60_000 });
  const c = q.data?.cards;
  return (
    <HeroPage
      eyebrow={user ? `Welcome back, ${user.fullName.split(' ')[0]}` : undefined}
      title={user?.agency?.companyName ?? 'Transporter'}
      subtitle="Transporter"
      avatarName={user?.fullName}
      heroExtra={<Button title="Find bookings" icon="search-outline" onPress={() => router.push(ROUTES.transporter.market)} style={{ backgroundColor: colors.accent }} />}
      refreshing={q.refreshing}
      onRefresh={q.refresh}
    >
      {q.data && q.data.verificationStatus !== 'APPROVED' ? <Banner tone="warning">Verification pending. Complete your documents and fleet on the web portal. Bidding opens once verified.</Banner> : null}
      <QueryState loading={q.loading} error={q.error} onRetry={q.reload} skeleton="home" skeletonCount={8} />
      {c ? (
        <Stats
          items={[
            { label: 'New booking requests', value: c.newBookingRequests, icon: 'search-outline', tone: 'brand', onPress: () => router.push(ROUTES.transporter.market) },
            { label: 'Pending offers', value: c.pendingOffers, icon: 'pricetags-outline', tone: 'accent', onPress: () => router.push(ROUTES.transporter.offers) },
            { label: 'Confirmed bookings', value: c.confirmedBookings, icon: 'checkmark-circle-outline', tone: 'success', onPress: () => router.push(ROUTES.transporter.trips) },
            { label: 'Active trips', value: c.activeTrips, icon: 'navigate-outline', tone: 'brand', onPress: () => router.push(ROUTES.transporter.trips) },
            { label: 'Available tankers', value: `${c.availableTankers}/${c.totalTankers}`, icon: 'bus-outline', tone: 'success' },
            { label: 'Active drivers', value: c.activeDrivers, icon: 'people-outline', tone: 'brand' },
            { label: "This month's freight", value: inr(c.monthlyFreight), icon: 'wallet-outline', tone: 'success' },
            { label: 'Pending settlements', value: inr(c.pendingSettlements), icon: 'time-outline', tone: 'warning' },
          ]}
        />
      ) : null}
      <QuickActions
        items={[
          { label: 'Marketplace', icon: 'search-outline', onPress: () => router.push(ROUTES.transporter.market) },
          { label: 'My offers', icon: 'pricetags-outline', tone: 'accent', onPress: () => router.push(ROUTES.transporter.offers) },
          { label: 'Assign trips', icon: 'git-branch-outline', tone: 'success', onPress: () => router.push(ROUTES.transporter.trips) },
          { label: 'Add driver', icon: 'person-add-outline', tone: 'warning', onPress: () => router.push(ROUTES.transporter.addDriver) },
        ]}
      />
      {q.loading ? <ListSkeleton count={2} /> : null}
      {q.data?.activeTrips.length ? <Text style={{ fontSize: 18, fontWeight: '800', color: colors.ink, marginTop: 6 }}>Active trips</Text> : null}
      {q.data?.activeTrips.map((t) => (
        <ListCard
          key={t.id}
          code={t.tripCode}
          status={<Pill label={humanize(t.status)} tone={toneFor(t.status)} />}
          from={t.pickup}
          to={t.delivery}
          meta={[`${t.tanker?.registrationNumber ?? 'No tanker'}${t.etaAt ? ` · ETA ${dateTime(t.etaAt)}` : ''}`]}
          onPress={() => router.push(ROUTES.transporter.trip(t.id))}
        />
      ))}
      {q.data?.alerts.length ? <Text style={{ fontSize: 18, fontWeight: '800', color: colors.ink, marginTop: 6 }}>Document and driver alerts</Text> : null}
      {q.data?.alerts.slice(0, 6).map((a, i) => (
        <Card key={i} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <IconBadge icon="warning-outline" tone="warning" size={36} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>{a.subject}</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{a.detail}</Text>
          </View>
        </Card>
      ))}
    </HeroPage>
  );
}
