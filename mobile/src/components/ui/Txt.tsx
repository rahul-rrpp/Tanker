import type { ReactNode } from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';
import { colors, type } from '@/theme';

export type TextVariant = keyof typeof type;
type TextColor = 'ink' | 'muted' | 'faint' | 'accent' | 'success' | 'warning' | 'danger' | 'onInk' | 'onInkMuted' | 'link';

const COLOR: Record<TextColor, string> = {
  ink: colors.ink,
  muted: colors.muted,
  faint: colors.faint,
  accent: colors.accent,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  onInk: colors.onInk,
  onInkMuted: colors.onInkMuted,
  link: colors.brand600,
};

/**
 * Text in the Manifest type scale: `<T v="heading">`, `<T v="code" c="muted">`. Every redesigned screen
 * sets text through this, so fonts, sizes and colours stay in one place.
 */
export function T({ v = 'body', c = 'ink', align, style, children, ...rest }: TextProps & { v?: TextVariant; c?: TextColor; align?: TextStyle['textAlign']; children?: ReactNode }) {
  return (
    <Text {...rest} style={[type[v], { color: COLOR[c] }, align ? { textAlign: align } : null, style]}>
      {children}
    </Text>
  );
}
