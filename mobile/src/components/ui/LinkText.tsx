import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { colors } from '@/theme';

/** Tappable inline text link. */
export function LinkText({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <Text onPress={onPress} style={{ color: colors.brand600, fontWeight: '600' }} accessibilityRole="link" suppressHighlighting>
      {children}
    </Text>
  );
}
