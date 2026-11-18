import { useEffect, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { colors, pageStyles as s } from '@/theme';

/**
 * Skeleton placeholders shaped like the real content, shown while a screen's data first loads.
 * Every bone shares one pulse animation (native driver), so dozens of bones cost one animation and
 * they all breathe in sync. With "reduce motion" on, bones stay still.
 */

const pulse = new Animated.Value(0);
let running: Animated.CompositeAnimation | null = null;
let users = 0;
const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] });

function useSharedPulse() {
  useEffect(() => {
    users += 1;
    let cancelled = false;
    if (!running) {
      void AccessibilityInfo.isReduceMotionEnabled()
        .catch(() => false)
        .then((reduce) => {
          if (cancelled || reduce || running || users === 0) return;
          running = Animated.loop(
            Animated.sequence([
              Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
              Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
            ]),
          );
          running.start();
        });
    }
    return () => {
      cancelled = true;
      users -= 1;
      if (users === 0 && running) {
        running.stop();
        running = null;
        pulse.setValue(0);
      }
    };
  }, []);
}

/** One placeholder block. */
export function Bone({ w = '100%', h = 12, r = 6, style }: { w?: DimensionValue; h?: number; r?: number; style?: StyleProp<ViewStyle> }) {
  useSharedPulse();
  return <Animated.View style={[{ width: w, height: h, borderRadius: r, backgroundColor: colors.line, opacity }, style]} />;
}

const Card = ({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) => <View style={[s.card, style]}>{children}</View>;
const Row = ({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) => <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;

/** Same shape as LedgerRow: date column, code + status, route + amount, a meta line; hairline below. */
export function ListCardSkeleton({ last }: { last?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 14, paddingVertical: 16, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.lineSoft }}>
      <View style={{ width: 34, gap: 6 }}><Bone w={26} h={20} r={4} /><Bone w={24} h={8} /></View>
      <View style={{ flex: 1, gap: 9 }}>
        <Row style={{ justifyContent: 'space-between' }}><Bone w={96} h={10} /><Bone w={70} h={10} /></Row>
        <Row style={{ justifyContent: 'space-between' }}><Bone w="58%" h={16} /><Bone w={64} h={16} /></Row>
        <Bone w="42%" h={10} />
      </View>
    </View>
  );
}

export function ListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <View accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: count }, (_, i) => <ListCardSkeleton key={i} last={i === count - 1} />)}
    </View>
  );
}

/** InfoCard-like block: a title and rows of icon tile + label/value. */
export function InfoCardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Card style={{ gap: 16 }}>
      <Bone w={120} h={14} />
      {Array.from({ length: rows }, (_, i) => (
        <Row key={i} style={{ gap: 12 }}>
          <Bone w={36} h={36} r={12} />
          <View style={{ flex: 1, gap: 7 }}><Bone w="30%" h={9} /><Bone w={i % 2 ? '55%' : '75%'} h={12} /></View>
        </Row>
      ))}
    </Card>
  );
}

/** Detail screens: SummaryCard (code, status, full route, price panel) then an InfoCard. */
export function DetailSkeleton() {
  return (
    <View style={{ gap: 12 }} accessibilityLabel="Loading" accessibilityRole="progressbar">
      <Card style={{ gap: 16 }}>
        <Row style={{ justifyContent: 'space-between' }}><Bone w={110} h={12} /><Bone w={84} h={24} r={12} /></Row>
        <View style={{ gap: 14 }}>
          <Row style={{ gap: 10, alignItems: 'flex-start' }}><Bone w={12} h={12} r={6} /><View style={{ flex: 1, gap: 6 }}><Bone w="50%" h={15} /><Bone w="80%" h={10} /></View></Row>
          <Row style={{ gap: 10, alignItems: 'flex-start' }}><Bone w={12} h={12} r={3} /><View style={{ flex: 1, gap: 6 }}><Bone w="44%" h={15} /><Bone w="72%" h={10} /></View></Row>
        </View>
        <View style={{ backgroundColor: colors.canvas, borderRadius: 14, padding: 14, gap: 8 }}><Bone w={70} h={9} /><Bone w={130} h={22} /></View>
      </Card>
      <InfoCardSkeleton />
    </View>
  );
}

/** Home screens' KPI tiles (same grid as Stats). The quick actions below them render without data. */
export function HomeSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[s.stat, { gap: 12 }]}>
          <Bone w={40} h={40} r={12} />
          <Bone w="45%" h={22} />
          <Bone w="70%" h={10} />
        </View>
      ))}
    </View>
  );
}

/** Notification feed: title + time, two text lines; hairline rows. */
export function FeedSkeleton({ count = 5 }: { count?: number }) {
  return (
    <View accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ paddingVertical: 16, paddingLeft: 20, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft }}>
          <Row style={{ justifyContent: 'space-between' }}><Bone w="50%" h={13} /><Bone w={48} h={9} /></Row>
          <Bone w="92%" h={10} />
          <Bone w={i % 2 ? '55%' : '75%'} h={10} />
        </View>
      ))}
    </View>
  );
}

/** Compact rows (fleet, drivers, devices): icon badge, two lines, trailing pill. */
export function RowsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View style={{ gap: 12 }} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Bone w={40} h={40} r={12} />
          <View style={{ flex: 1, gap: 7 }}><Bone w="50%" h={13} /><Bone w="70%" h={10} /></View>
          <Bone w={64} h={22} r={11} />
        </Card>
      ))}
    </View>
  );
}

export type SkeletonKind = 'list' | 'detail' | 'home' | 'feed' | 'rows';

export function SkeletonFor({ kind, count }: { kind: SkeletonKind; count?: number }) {
  switch (kind) {
    case 'detail': return <DetailSkeleton />;
    case 'home': return <HomeSkeleton count={count} />;
    case 'feed': return <FeedSkeleton count={count} />;
    case 'rows': return <RowsSkeleton count={count} />;
    default: return <ListSkeleton count={count} />;
  }
}
