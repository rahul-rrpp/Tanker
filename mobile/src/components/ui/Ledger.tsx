import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, fonts } from '@/theme';
import { dayParts, routeText } from '@/utils/format';
import { T } from './Txt';

/**
 * One line of the ledger: the row type for bookings, trips, offers and the marketplace.
 *
 *   15   TLB0000014 · DEMO               ● Searching
 *   NOV  Pune → Mumbai                       ₹6,550
 *        Lubricating Oil · 12 KL          your offer
 *
 * Rows sit directly on the paper, separated by hairlines; no card per item. `flag` adds a thin signal
 * bar on the left for rows that need the user's attention.
 */
export function LedgerRow({
  date,
  code,
  status,
  from,
  to,
  title,
  meta,
  amount,
  amountLabel,
  onPress,
  flag,
  children,
  last,
}: {
  date?: string | null;
  code?: string;
  status?: ReactNode;
  from?: string | null;
  to?: string | null;
  title?: string;
  meta?: (string | null | undefined | false)[];
  amount?: string;
  amountLabel?: string;
  onPress?: () => void;
  flag?: boolean;
  children?: ReactNode;
  last?: boolean;
}) {
  const d = dayParts(date);
  const lines = (meta ?? []).filter(Boolean) as string[];
  const heading = title ?? (from !== undefined || to !== undefined ? routeText(from, to) : undefined);
  const body = (
    <View style={{ flexDirection: 'row', gap: 14, paddingVertical: 16 }}>
      {flag ? <View style={{ position: 'absolute', left: -20, top: 16, bottom: 16, width: 3, backgroundColor: colors.accent }} /> : null}
      {d ? (
        <View style={{ width: 34, alignItems: 'flex-start' }}>
          <T v="heading" style={{ lineHeight: 24 }}>{d.day}</T>
          <T v="eyebrow" c="faint" style={{ letterSpacing: 1 }}>{d.month}</T>
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {code ? <T v="code" c="faint" numberOfLines={1} style={{ flexShrink: 1 }}>{code}</T> : <View />}
          {status}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
          {heading ? <T v="subheading" numberOfLines={1} style={{ flex: 1 }}>{heading}</T> : <View style={{ flex: 1 }} />}
          {amount ? <T v="figure" style={{ fontFamily: fonts.monoBold }}>{amount}</T> : onPress ? <Ionicons name="chevron-forward" size={16} color={colors.faint} /> : null}
        </View>
        {lines.length || amountLabel ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
            <View style={{ flex: 1, gap: 2 }}>
              {lines.map((l, i) => <T key={i} v="caption" c="muted" numberOfLines={1}>{l}</T>)}
            </View>
            {amountLabel ? <T v="caption" c="faint">{amountLabel}</T> : null}
          </View>
        ) : null}
        {children}
      </View>
    </View>
  );
  const rule = { borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, borderBottomColor: colors.line };
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [rule, pressed && { backgroundColor: colors.neutralBg, marginHorizontal: -20, paddingHorizontal: 20 }]}>
      {body}
    </Pressable>
  ) : (
    <View style={rule}>{body}</View>
  );
}
