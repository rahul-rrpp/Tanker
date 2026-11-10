import { forwardRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius } from '../lib/theme';

/** Keyboard-safe, scrollable screen container. */
export function Screen({ children, footer, padded = true }: { children: ReactNode; footer?: ReactNode; padded?: boolean }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[padded && styles.content, { flexGrow: 1 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {children}
        </ScrollView>
        {footer && <View style={styles.footer}>{footer}</View>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ marginBottom: 24 }}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  style?: ViewStyle;
}

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

const buttonVariants = {
  primary: { container: { backgroundColor: colors.brand600 }, text: { color: '#fff' } },
  secondary: { container: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line }, text: { color: colors.ink } },
  ghost: { container: { backgroundColor: 'transparent' }, text: { color: colors.brand600 } },
  danger: { container: { backgroundColor: colors.danger }, text: { color: '#fff' } },
};

export interface FieldProps extends TextInputProps {
  label: string;
  error?: string;
  hint?: string;
  prefix?: string;
  required?: boolean;
}

export const Field = forwardRef<TextInput, FieldProps>(function Field({ label, error, hint, prefix, required, style, ...rest }, ref) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={{ color: colors.danger }}> *</Text> : null}
      </Text>
      <View style={[styles.inputWrap, focused && styles.inputFocused, error ? styles.inputError : null]}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          ref={ref}
          placeholderTextColor="#94a3b8"
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[styles.input, style]}
          {...rest}
        />
      </View>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
});

export const PasswordField = forwardRef<TextInput, FieldProps>(function PasswordField(props, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <View>
      <Field ref={ref} secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false} {...props} />
      <Pressable
        onPress={() => setVisible((v) => !v)}
        style={styles.eye}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
        hitSlop={8}
      >
        <Text style={{ color: colors.brand600, fontWeight: '600', fontSize: 13 }}>{visible ? 'Hide' : 'Show'}</Text>
      </Pressable>
    </View>
  );
});

export function Banner({ tone = 'error', children }: { tone?: 'error' | 'success' | 'info' | 'warning'; children: ReactNode }) {
  const palette = {
    error: { bg: colors.dangerBg, fg: colors.danger },
    success: { bg: colors.successBg, fg: colors.success },
    info: { bg: colors.brand50, fg: colors.brand700 },
    warning: { bg: colors.warningBg, fg: colors.warning },
  }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: palette.bg }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={{ color: palette.fg, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

/** Chip-style single-select (used for licence type, customer type). */
export function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
}: {
  label: string;
  options: { value: T; label: string }[];
  value?: T;
  onChange: (v: T) => void;
  error?: string;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={{ color: selected ? colors.brand700 : colors.ink, fontWeight: '600' }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function LinkText({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <Text onPress={onPress} style={{ color: colors.brand600, fontWeight: '600' }} accessibilityRole="link" suppressHighlighting>
      {children}
    </Text>
  );
}

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 20, paddingBottom: 32 },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface },
  title: { fontSize: 26, fontWeight: '700', color: colors.ink, letterSpacing: -0.3 },
  subtitle: { marginTop: 6, fontSize: 15, lineHeight: 22, color: colors.muted },
  button: { height: 50, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  label: { fontSize: 14, fontWeight: '600', color: colors.ink, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.field,
    backgroundColor: '#fff',
  },
  inputFocused: { borderColor: colors.brand500, borderWidth: 2 },
  inputError: { borderColor: colors.danger },
  prefix: { paddingHorizontal: 12, color: colors.muted, fontSize: 16, borderRightWidth: 1, borderRightColor: colors.line, lineHeight: 48 },
  input: { flex: 1, height: '100%', paddingHorizontal: 14, fontSize: 16, color: colors.ink },
  error: { marginTop: 6, fontSize: 13, color: colors.danger, fontWeight: '500' },
  hint: { marginTop: 6, fontSize: 13, color: colors.muted },
  eye: { position: 'absolute', right: 14, top: 40 },
  banner: { borderRadius: radius.field, padding: 12, marginBottom: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  chipSelected: { borderColor: colors.brand500, backgroundColor: colors.brand50 },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, padding: 16 },
});
