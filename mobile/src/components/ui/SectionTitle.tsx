import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { colors } from '@/theme';
import { T } from './Txt';

/** Small-caps eyebrow that opens a section. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <T v="eyebrow" c="muted" style={{ marginTop: 12 }}>{children}</T>;
}

/**
 * Section opener with an optional count and a text action on the right ("View all").
 * A hairline under it ties the section to the rows that follow.
 */
export function SectionHeader({ title, count, action, onAction, rule = true }: { title: string; count?: number; action?: string; onAction?: () => void; rule?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 18, paddingBottom: 8, borderBottomWidth: rule ? 1 : 0, borderBottomColor: colors.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <T v="eyebrow" c="muted">{title}</T>
        {count !== undefined ? <T v="code" c="faint">{String(count).padStart(2, '0')}</T> : null}
      </View>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="link">
          <T v="label" c="link">{action}</T>
        </Pressable>
      ) : null}
    </View>
  );
}
