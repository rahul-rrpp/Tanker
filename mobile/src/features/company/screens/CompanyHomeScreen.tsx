import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/features/auth/context/AuthContext';
import type { CompanyOffer } from '@/features/company/components/CompanyOfferCard';
import { Appear, Avatar, Banner, Bone, BottomBar, Button, LedgerRow, ListSkeleton, Pill, SectionHeader, T } from '@/components/ui';
import { LOGO_MARK } from '@/components/ui/Logo';
import { toneFor } from '@/utils/status';
import { dateTime, humanize, inr, routeText } from '@/utils/format';
import { colors, layout } from '@/theme';
import { useQuery } from '@/hooks';
import { ENDPOINTS } from '@/services/api';
import { ROUTES } from '@/navigation/routes';
import type { CompanyTrip } from '../types';

type Dash = {
  summary: { pendingBookings: number; offersReceived: number; activeTrips: number; completedTrips: number; totalTransportExpense: number | string; averageFreightPerTrip: number | string };
  // The dashboard API sends plain city names and the product name (not location objects).
  recentBookings: { id: string; bookingCode: string; status: string; customerOffer: string; acceptedFreight: string | null; pickup: string; delivery: string; product: string; isDemo: boolean }[];
};

/** "Good morning" etc. in India time. */
function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/**
 * Company home. Answers three questions in order: what needs me (offers to decide), where are my loads
 * (trips on the road), what did I book recently. The one primary action, Book a tanker, sits in the
 * thumb zone at the bottom.
 */
export default function CompanyHomeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const q = useQuery<Dash>(ENDPOINTS.company.dashboard);
  const offers = useQuery<{ offers: CompanyOffer[] }>(ENDPOINTS.company.offers('open'), { pollMs: 30_000 });
  const trips = useQuery<{ trips: CompanyTrip[] }>(ENDPOINTS.company.trips('active'), { pollMs: 60_000 });
  const c = user?.company;
  const s = q.data?.summary;
  const verified = c?.status === 'VERIFIED';
  const needsYou = (offers.data?.offers ?? []).filter((o) => o.status === 'PENDING' && new Date(o.expiresAt).getTime() > Date.now());
  const live = trips.data?.trips ?? [];
  const refreshing = q.refreshing || offers.refreshing || trips.refreshing;
  const refresh = () => { void q.refresh(); void offers.refresh(); void trips.refresh(); };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.ink} colors={[colors.ink]} />}
      >
        {/* Masthead: brand pin + company, notifications and account on the right. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8, paddingBottom: 18 }}>
          <Image source={LOGO_MARK} style={{ width: 26, height: 26 }} resizeMode="contain" accessibilityIgnoresInvertColors />
          <View style={{ flex: 1 }}>
            <T v="label" numberOfLines={1}>{c?.name ?? 'Company'}</T>
            {c ? <T v="code" c="faint">{c.companyCode}</T> : null}
          </View>
          <Pressable onPress={() => router.push(ROUTES.notifications)} accessibilityRole="button" accessibilityLabel="Notifications" hitSlop={6} style={styles.iconBtn}>
            <Ionicons name="notifications-outline" size={20} color={colors.ink} />
          </Pressable>
          <Pressable onPress={() => router.push(ROUTES.company.account)} accessibilityRole="button" accessibilityLabel="Account" hitSlop={6}>
            <Avatar name={user?.fullName ?? '?'} size={38} />
          </Pressable>
        </View>

        {/* Headline: the state of the business in one sentence. */}
        <T v="label" c="muted">{greeting()}, {user?.fullName.split(' ')[0]}</T>
        {s ? (
          <Appear>
            <T v="display" style={{ marginTop: 6 }}>
              {s.activeTrips} {s.activeTrips === 1 ? 'tanker' : 'tankers'} on the road.{'\n'}
              <T v="display" c={needsYou.length ? 'accent' : 'muted'}>
                {needsYou.length ? `${needsYou.length} ${needsYou.length === 1 ? 'offer needs' : 'offers need'} you.` : 'Nothing waiting on you.'}
              </T>
            </T>
          </Appear>
        ) : q.loading ? (
          <View style={{ gap: 10, marginTop: 10 }}><Bone w="85%" h={30} /><Bone w="60%" h={30} /></View>
        ) : null}

        {q.error ? <View style={{ marginTop: 16 }}><Banner>{q.error}</Banner></View> : null}
        {c && !verified ? (
          <View style={{ marginTop: 16 }}>
            <Banner tone="warning">{c.status === 'REJECTED' ? `Verification rejected. ${c.statusReason ?? ''}` : 'Verification pending. You can book tankers once OnlyTanker verifies your documents.'}</Banner>
          </View>
        ) : null}

        {/* Statement strip: money, quietly, in mono. */}
        {s ? (
          <View style={styles.strip}>
            <Stat label="Spent" value={inr(s.totalTransportExpense)} />
            <Stat label="Avg / trip" value={inr(s.averageFreightPerTrip)} />
            <Stat label="Delivered" value={String(s.completedTrips)} last />
          </View>
        ) : null}

        {/* Needs you: offers waiting for a decision. */}
        <SectionHeader title="Needs you" count={offers.data ? needsYou.length : undefined} action={needsYou.length ? 'All offers' : undefined} onAction={() => router.push(ROUTES.company.offers)} />
        {offers.loading ? <ListSkeleton count={2} /> : needsYou.length ? (
          needsYou.slice(0, 3).map((o, i) => (
            <Appear key={o.id} index={i}>
              <LedgerRow
                flag
                code={`${o.booking?.bookingCode ?? ''} · ROUND ${o.round}`}
                status={<Pill label="Your decision" tone="warning" />}
                title={o.transporter.companyName}
                amount={inr(o.currentAmount)}
                amountLabel="offered"
                meta={[`★ ${Number(o.transporter.rating).toFixed(1)} · ${o.transporter.completedTrips} trips · until ${dateTime(o.expiresAt)}`]}
                onPress={() => (o.booking ? router.push(ROUTES.company.booking(o.booking.id)) : router.push(ROUTES.company.offers))}
                last={i === Math.min(needsYou.length, 3) - 1}
              />
            </Appear>
          ))
        ) : (
          <T v="label" c="muted" style={{ paddingVertical: 14 }}>No offers waiting. New offers from transporters show up here.</T>
        )}

        {/* On the road: live trips as slips you can swipe through. */}
        <SectionHeader title="On the road" count={trips.data ? live.length : undefined} action={live.length ? 'All trips' : undefined} onAction={() => router.push(ROUTES.company.trips)} rule={false} />
        {trips.loading ? (
          <View style={{ flexDirection: 'row', gap: 12 }}>{[0, 1].map((i) => <View key={i} style={[styles.slip, { gap: 10 }]}><Bone w={90} h={10} /><Bone w="80%" h={16} /><Bone w="50%" h={10} /></View>)}</View>
        ) : live.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -layout.gutter }} contentContainerStyle={{ paddingHorizontal: layout.gutter, gap: 12 }}>
            {live.map((t, i) => (
              <Appear key={t.id} index={i}>
                <Pressable onPress={() => router.push(ROUTES.company.trip(t.id))} accessibilityRole="button" style={({ pressed }) => [styles.slip, pressed && { opacity: 0.85 }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <T v="code" c="faint">{t.tripCode}</T>
                    <Pill label={humanize(t.status)} tone={toneFor(t.status)} live={t.status === 'IN_TRANSIT'} />
                  </View>
                  <T v="subheading" numberOfLines={1} style={{ marginTop: 10 }}>{routeText(t.pickup?.city, t.delivery?.city)}</T>
                  <T v="caption" c="muted" numberOfLines={1} style={{ marginTop: 4 }}>{t.transporter.companyName}</T>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line }}>
                    <T v="code">{t.tanker?.registrationNumber ?? 'Tanker pending'}</T>
                    <T v="code" c="muted">{t.etaAt ? `ETA ${dateTime(t.etaAt)}` : '—'}</T>
                  </View>
                </Pressable>
              </Appear>
            ))}
          </ScrollView>
        ) : (
          <T v="label" c="muted" style={{ paddingVertical: 6 }}>No tankers on the road right now.</T>
        )}

        {/* Recent bookings. */}
        <SectionHeader title="Recent bookings" action="View all" onAction={() => router.push(ROUTES.company.bookings)} />
        {q.loading ? <ListSkeleton count={3} /> : q.data?.recentBookings.length ? (
          q.data.recentBookings.map((b, i, all) => (
            <LedgerRow
              key={b.id}
              code={`${b.bookingCode}${b.isDemo ? ' · DEMO' : ''}`}
              status={<Pill label={humanize(b.status)} tone={toneFor(b.status)} />}
              from={b.pickup}
              to={b.delivery}
              amount={inr(b.acceptedFreight ?? b.customerOffer)}
              amountLabel={b.acceptedFreight ? 'agreed' : 'your offer'}
              meta={[b.product]}
              onPress={() => router.push(ROUTES.company.booking(b.id))}
              last={i === all.length - 1}
            />
          ))
        ) : (
          <T v="label" c="muted" style={{ paddingVertical: 14 }}>No bookings yet. Book your first tanker below.</T>
        )}
      </ScrollView>

      <BottomBar>
        <Button title="Book a tanker" variant="accent" size="lg" icon="add" onPress={() => router.push(ROUTES.company.newBooking)} disabled={!verified} />
      </BottomBar>
    </SafeAreaView>
  );
}

function Stat({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 12, borderRightWidth: last ? 0 : StyleSheet.hairlineWidth, borderRightColor: colors.line }}>
      <T v="eyebrow" c="faint" style={{ fontSize: 10 }}>{label}</T>
      <T v="figure" numberOfLines={1} adjustsFontSizeToFit style={{ marginTop: 4 }}>{value}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  iconBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  strip: { flexDirection: 'row', marginTop: 22, marginHorizontal: -12, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  slip: { width: 260, backgroundColor: colors.surface, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: 16 },
});
