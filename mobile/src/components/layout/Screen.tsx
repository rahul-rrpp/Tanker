import type { ReactNode } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { LOGO_MARK } from '@/components/ui/Logo';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formStyles as styles } from '@/theme';

/** Keyboard-safe, scrollable full-screen container for auth and form screens, with an optional sticky footer. */
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

/** Large screen title with an optional subtitle, under the OnlyTanker pin (auth and sign-up screens). */
export function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ marginBottom: 24 }}>
      <Image source={LOGO_MARK} style={{ width: 52, height: 52, marginLeft: -6, marginBottom: 14 }} resizeMode="contain" accessibilityIgnoresInvertColors />
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}
