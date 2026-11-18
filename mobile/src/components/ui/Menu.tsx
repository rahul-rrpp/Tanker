import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '@/theme';
import type { IconName } from '@/types';
import type { BadgeTone } from './IconBadge';
import { T } from './Txt';

/** Plain settings row: line icon, label, optional detail, chevron. Danger rows are red, nothing else is coloured. */
export function MenuRow({ icon, label, detail, onPress, tone = 'brand', last }: { icon: IconName; label: string; detail?: string; onPress: () => void; tone?: BadgeTone; last?: boolean }) {
  const danger = tone === 'danger';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingVertical: 12, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, borderBottomColor: colors.line, opacity: pressed ? 0.6 : 1 })}
    >
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.ink} />
      <View style={{ flex: 1 }}>
        <T v="bodyStrong" c={danger ? 'danger' : 'ink'}>{label}</T>
        {detail ? <T v="caption" c="muted">{detail}</T> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.faint} />
    </Pressable>
  );
}

/** A group of MenuRows between hairlines, directly on the paper. */
export function MenuGroup({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <View>
      {title ? <T v="eyebrow" c="muted" style={{ paddingTop: 18, paddingBottom: 4 }}>{title}</T> : null}
      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line }}>{children}</View>
    </View>
  );
}
