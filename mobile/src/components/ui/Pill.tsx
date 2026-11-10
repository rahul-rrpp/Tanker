import { Text } from 'react-native';
import { colors, pageStyles as s } from '@/theme';
import type { Tone } from '@/types';

const TONES: Record<Tone, readonly [string, string]> = {
  neutral: [colors.neutralBg, colors.muted],
  info: [colors.brand50, colors.brand600],
  success: [colors.successBg, colors.success],
  warning: [colors.warningBg, colors.warning],
  danger: [colors.dangerBg, colors.danger],
};

/** Small rounded status label. */
export function Pill({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const [bg, fg] = TONES[tone];
  return <Text style={[s.pill, { backgroundColor: bg, color: fg }]}>{label}</Text>;
}
