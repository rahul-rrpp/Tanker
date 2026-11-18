import { Text, View } from 'react-native';
import { colors, fonts } from '@/theme';
import type { Tone } from '@/types';

export const TONE_COLOR: Record<Tone, string> = {
  neutral: colors.faint,
  info: colors.brand600,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
};

/**
 * Status mark: a small coloured dot and the word, no filled pill. `live` turns the dot signal-orange for
 * things that are moving right now.
 */
export function Pill({ label, tone = 'neutral', live }: { label: string; tone?: Tone; live?: boolean }) {
  const c = live ? colors.accent : TONE_COLOR[tone];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityLabel={`Status: ${label}`}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c }} />
      <Text style={{ fontFamily: fonts.medium, fontSize: 12, color: live ? colors.accent : colors.ink }} numberOfLines={1}>{label}</Text>
    </View>
  );
}
