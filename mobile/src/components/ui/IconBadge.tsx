import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { colors } from '@/theme';
import type { IconName } from '@/types';

export type BadgeTone = 'brand' | 'success' | 'warning' | 'danger' | 'accent' | 'neutral';

const TONES: Record<BadgeTone, [string, string]> = {
  brand: [colors.brand50, colors.brand600],
  success: [colors.successBg, colors.success],
  warning: [colors.warningBg, colors.warning],
  danger: [colors.dangerBg, colors.danger],
  accent: [colors.accentBg, colors.accent],
  neutral: [colors.neutralBg, colors.muted],
};

/** An icon on a soft tinted rounded square — the leading visual of tiles, rows and list items. */
export function IconBadge({ icon, tone = 'brand', size = 40 }: { icon: IconName; tone?: BadgeTone; size?: number }) {
  const [bg, fg] = TONES[tone];
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.24, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={size * 0.5} color={fg} />
    </View>
  );
}
