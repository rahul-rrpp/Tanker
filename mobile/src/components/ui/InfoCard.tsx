import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { colors, fonts } from '@/theme';
import type { IconName } from '@/types';
import { Card } from './Card';

export type InfoItem = { icon?: IconName; label: string; value: ReactNode } | null | false | undefined;

/** One labelled value with a leading icon. */
export function InfoRow({ icon, label, value, last }: { icon?: IconName; label: string; value: ReactNode; last?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 11, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.lineSoft }}>
      {icon ? <Ionicons name={icon} size={18} color={colors.brand500} style={{ marginTop: 1 }} /> : null}
      <Text style={{ fontFamily: fonts.regular, color: colors.muted, fontSize: 13, width: 112 }}>{label}</Text>
      <Text style={{ flex: 1, color: colors.ink, fontSize: 14, fontFamily: fonts.semibold, textAlign: 'right' }}>{value ?? '—'}</Text>
    </View>
  );
}

/** A titled group of InfoRows (falsy items are skipped), with optional footer content (buttons). */
export function InfoCard({ title, items, footer }: { title?: string; items: InfoItem[]; footer?: ReactNode }) {
  const rows = items.filter(Boolean) as Exclude<InfoItem, null | false | undefined>[];
  return (
    <Card style={{ paddingVertical: 6 }}>
      {title ? <Text style={{ fontSize: 13, fontFamily: fonts.bold, color: colors.muted, letterSpacing: 0.6, textTransform: 'uppercase', paddingTop: 10, paddingBottom: 2 }}>{title}</Text> : null}
      {rows.map((r, i) => <InfoRow key={r.label} icon={r.icon} label={r.label} value={r.value} last={i === rows.length - 1 && !footer} />)}
      {footer ? <View style={{ paddingVertical: 10, gap: 8 }}>{footer}</View> : null}
    </Card>
  );
}
