import { forwardRef, useState } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, formStyles as styles } from '@/theme';

export interface FieldProps extends TextInputProps {
  label: string;
  error?: string;
  hint?: string;
  prefix?: string;
  required?: boolean;
}

/** Labelled text input with focus, error and hint states. */
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
          placeholderTextColor={colors.placeholder}
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

/** Field with a Show/Hide toggle. */
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
