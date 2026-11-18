import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { colors, fonts, formStyles as styles } from '@/theme';

const PALETTE = {
  error: { bg: colors.dangerBg, fg: colors.danger },
  success: { bg: colors.successBg, fg: colors.success },
  info: { bg: colors.neutralBg, fg: colors.ink },
  warning: { bg: colors.warningBg, fg: colors.warning },
};

/** Inline message: tinted strip with a coloured rule on the left. */
export function Banner({ tone = 'error', children }: { tone?: keyof typeof PALETTE; children: ReactNode }) {
  const palette = PALETTE[tone];
  return (
    <View style={[styles.banner, { backgroundColor: palette.bg, borderLeftWidth: 3, borderLeftColor: palette.fg, borderRadius: 6 }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={{ color: tone === 'info' ? colors.ink : palette.fg, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}
