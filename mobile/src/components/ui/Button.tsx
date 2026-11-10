import { ActivityIndicator, Pressable, Text, type ViewStyle } from 'react-native';
import { colors, formStyles as styles } from '@/theme';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  style?: ViewStyle;
}

const buttonVariants = {
  primary: { container: { backgroundColor: colors.brand600 }, text: { color: colors.white } },
  secondary: { container: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, text: { color: colors.ink } },
  ghost: { container: { backgroundColor: 'transparent' }, text: { color: colors.brand600 } },
  danger: { container: { backgroundColor: colors.danger }, text: { color: colors.white } },
};

export function Button({ title, onPress, loading, disabled, variant = 'primary', style }: ButtonProps) {
  const inactive = disabled || loading;
  const v = buttonVariants[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [styles.button, v.container, pressed && { opacity: 0.85 }, inactive && { opacity: 0.55 }, style]}
    >
      {loading ? <ActivityIndicator color={v.text.color} /> : <Text style={[styles.buttonText, v.text]}>{title}</Text>}
    </Pressable>
  );
}
