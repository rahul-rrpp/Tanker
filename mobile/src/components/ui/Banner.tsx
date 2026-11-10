import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { colors, formStyles as styles } from '@/theme';

const PALETTE = {
  error: { bg: colors.dangerBg, fg: colors.danger },
  success: { bg: colors.successBg, fg: colors.success },
  info: { bg: colors.brand50, fg: colors.brand700 },
  warning: { bg: colors.warningBg, fg: colors.warning },
};

/** Inline message box (errors, confirmations, tips). */
export function Banner({ tone = 'error', children }: { tone?: keyof typeof PALETTE; children: ReactNode }) {
  const palette = PALETTE[tone];
  return (
    <View style={[styles.banner, { backgroundColor: palette.bg }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={{ color: palette.fg, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}
