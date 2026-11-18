import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { colors, pageStyles as s, fonts } from '@/theme';
import type { IconName } from '@/types';
import { IconBadge, type BadgeTone } from './IconBadge';

export type StatItem = { label: string; value: ReactNode; icon?: IconName; tone?: BadgeTone; onPress?: () => void };

/** Two-column grid of KPI tiles: tinted icon, big number, label. */
export function Stats({ items }: { items: StatItem[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {items.map((i) => {
        const body = (
          <>
            {i.icon ? <IconBadge icon={i.icon} tone={i.tone ?? 'brand'} size={36} /> : null}
            <Text style={[s.statValue, { marginTop: 8 }]} numberOfLines={1} adjustsFontSizeToFit>{i.value}</Text>
            <Text style={s.statLabel} numberOfLines={2}>{i.label}</Text>
          </>
        );
        return i.onPress ? (
          <Pressable key={i.label} onPress={i.onPress} accessibilityRole="button" style={({ pressed }) => [s.stat, pressed && { opacity: 0.85 }]}>{body}</Pressable>
        ) : (
          <View key={i.label} style={s.stat}>{body}</View>
        );
      })}
    </View>
  );
}

/** Small "label · value" chips in a row, e.g. under a hero header. */
export function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 12 }}>
      <Text style={{ fontSize: 20, fontFamily: fonts.display, color: colors.ink }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.semibold, marginTop: 2 }} numberOfLines={1}>{label}</Text>
    </View>
  );
}
