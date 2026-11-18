import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, layout, shadows } from '@/theme';

let reduceMotion = false;
void AccessibilityInfo.isReduceMotionEnabled().then((v) => { reduceMotion = v; }).catch(() => undefined);
AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => { reduceMotion = v; });

/**
 * Subtle entrance: fade + 8 dp rise, staggered by `index` (first few items only, so long lists never
 * wait). Skipped entirely with "reduce motion".
 */
export function Appear({ index = 0, children, style }: { index?: number; children: ReactNode; style?: ViewStyle }) {
  const [skip] = useState(() => reduceMotion || index > 6);
  const v = useRef(new Animated.Value(skip ? 1 : 0)).current;
  useEffect(() => {
    if (skip) return;
    Animated.timing(v, { toValue: 1, duration: 320, delay: index * 45, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [index, skip, v]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** Sticky action area at the bottom of a screen, within thumb reach, above the safe area. */
export function BottomBar({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <SafeAreaView edges={['bottom']} style={[{ backgroundColor: colors.paper, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, ...shadows.raised }, style]}>
      <View style={{ paddingHorizontal: layout.gutter, paddingTop: 12, paddingBottom: 12, gap: 10 }}>{children}</View>
    </SafeAreaView>
  );
}
