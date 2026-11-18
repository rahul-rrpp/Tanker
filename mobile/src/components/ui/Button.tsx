import { Ionicons } from '@expo/vector-icons';
import { useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, Text, View, type ViewStyle } from 'react-native';
import { colors, formStyles as styles } from '@/theme';
import type { IconName } from '@/types';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /**
   * primary   — ink, the default for confirming things
   * accent    — signal orange; the ONE main action of a screen (Book a tanker, Next step)
   * secondary — outlined
   * ghost     — text only
   * danger    — destructive confirmation
   */
  variant?: 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
  /** Optional leading icon. */
  icon?: IconName;
  /** Optional trailing icon (e.g. an arrow on "Continue"). */
  trailingIcon?: IconName;
  style?: ViewStyle;
  size?: 'md' | 'lg';
}

const VARIANTS = {
  primary: { container: { backgroundColor: colors.ink }, fg: colors.onInk },
  accent: { container: { backgroundColor: colors.accent }, fg: colors.white },
  secondary: { container: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.ink }, fg: colors.ink },
  ghost: { container: { backgroundColor: 'transparent' }, fg: colors.ink },
  danger: { container: { backgroundColor: colors.danger }, fg: colors.white },
} as const;

/** Flat, confident buttons with a short spring on press. */
export function Button({ title, onPress, loading, disabled, variant = 'primary', icon, trailingIcon, style, size = 'md' }: ButtonProps) {
  const inactive = disabled || loading;
  const v = VARIANTS[variant];
  const scale = useRef(new Animated.Value(1)).current;
  const to = (value: number) => Animated.spring(scale, { toValue: value, speed: 40, bounciness: 0, useNativeDriver: true }).start();
  return (
    <Animated.View style={[{ transform: [{ scale }] }, style?.flex !== undefined ? { flex: style.flex } : null]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => to(0.97)}
        onPressOut={() => to(1)}
        disabled={inactive}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: inactive, busy: loading }}
        style={({ pressed }) => [styles.button, size === 'lg' && { height: 58 }, v.container, pressed && { opacity: 0.9 }, inactive && { opacity: 0.4 }, style]}
      >
        {loading ? (
          <ActivityIndicator color={v.fg} />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {icon ? <Ionicons name={icon} size={18} color={v.fg} /> : null}
            <Text style={[styles.buttonText, { color: v.fg }, size === 'lg' && { fontSize: 16 }]}>{title}</Text>
            {trailingIcon ? <Ionicons name={trailingIcon} size={18} color={v.fg} /> : null}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}
