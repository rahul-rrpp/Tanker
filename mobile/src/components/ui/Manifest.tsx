import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { colors } from '@/theme';
import { T } from './Txt';

export type ManifestItem = { label: string; value: ReactNode; mono?: boolean; strong?: boolean } | null | false | undefined;

/**
 * Key/value table in the style of a shipping manifest: quiet labels on the left, values right-aligned,
 * codes and figures in mono, hairlines between lines. Falsy items are skipped.
 */
export function ManifestTable({ title, items, style }: { title?: string; items: ManifestItem[]; style?: ViewStyle }) {
  const rows = items.filter(Boolean) as Exclude<ManifestItem, null | false | undefined>[];
  return (
    <View style={style}>
      {title ? <T v="eyebrow" c="muted" style={{ paddingBottom: 8 }}>{title}</T> : null}
      {rows.map((r, i) => (
        <View key={r.label} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 16, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, borderBottomWidth: i === rows.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.line }}>
          <T v="label" c="muted" style={{ width: 118 }}>{r.label}</T>
          {typeof r.value === 'string' || typeof r.value === 'number' || r.value === null || r.value === undefined ? (
            <T v={r.mono ? 'figure' : r.strong ? 'bodyStrong' : 'body'} align="right" style={{ flex: 1, fontSize: r.mono ? 14 : 15 }}>{r.value ?? '—'}</T>
          ) : (
            <View style={{ flex: 1, alignItems: 'flex-end' }}>{r.value}</View>
          )}
        </View>
      ))}
    </View>
  );
}

/**
 * Tear-off line between the head of a waybill and its body: a dashed rule with a notch on each side.
 * `bg` is the colour behind the card (the notches cut into it).
 */
export function Perforation({ bg = colors.paper, inset = 18 }: { bg?: string; inset?: number }) {
  return (
    <View style={{ height: 18, justifyContent: 'center', marginHorizontal: -inset }} importantForAccessibility="no-hide-descendants">
      <View style={{ marginHorizontal: 14, borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.line }} />
      <View style={{ position: 'absolute', left: -9, width: 18, height: 18, borderRadius: 9, backgroundColor: bg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line }} />
      <View style={{ position: 'absolute', right: -9, width: 18, height: 18, borderRadius: 9, backgroundColor: bg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line }} />
    </View>
  );
}

/** White waybill sheet on the paper: the container for a detail screen's primary object. */
export function Waybill({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ backgroundColor: colors.surface, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: 18, overflow: 'hidden' }, style]}>{children}</View>;
}

/**
 * The dark ink "ticket": reserved for the single most important live object on a screen (the driver's
 * next step, a trip on the road). Never more than one per screen.
 */
export function Ticket({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ backgroundColor: colors.ink, borderRadius: 14, padding: 20 }, style]}>{children}</View>;
}

/** Big figure with a caption above it: "Agreed freight / ₹6,550". */
export function Figure({ label, value, note, onInk, align = 'left' }: { label: string; value: string; note?: string; onInk?: boolean; align?: 'left' | 'right' }) {
  return (
    <View style={{ gap: 2, alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <T v="eyebrow" c={onInk ? 'onInkMuted' : 'muted'}>{label}</T>
      <T v="bigFigure" c={onInk ? 'onInk' : 'ink'}>{value}</T>
      {note ? <T v="caption" c={onInk ? 'onInkMuted' : 'muted'}>{note}</T> : null}
    </View>
  );
}
