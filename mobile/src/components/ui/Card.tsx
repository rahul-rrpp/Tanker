import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { pageStyles as s } from '@/theme';

/** Bordered surface; tappable when `onPress` is given. */
export function Card({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: ViewStyle }) {
  const body = <View style={[s.card, style]}>{children}</View>;
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>{body}</Pressable> : body;
}
