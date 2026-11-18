import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { colors, fonts } from '@/theme';

/** Tappable inline text link. */
export function LinkText({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <Text onPress={onPress} style={{ color: colors.brand600, fontFamily: fonts.semibold }} accessibilityRole="link" suppressHighlighting>
      {children}
    </Text>
  );
}
