import { Text, View } from 'react-native';
import { colors, fonts } from '@/theme';

/** A thin rounded progress bar with an optional caption. `value` is 0..1. */
export function ProgressBar({ value, caption }: { value: number; caption?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View style={{ gap: 6 }}>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.neutralBg, overflow: 'hidden' }}>
        <View style={{ width: `${pct * 100}%`, height: '100%', borderRadius: 4, backgroundColor: colors.brand500 }} />
      </View>
      {caption ? <Text style={{ fontFamily: fonts.regular, fontSize: 12, color: colors.muted }}>{caption}</Text> : null}
    </View>
  );
}

/** Vertical timeline: a dot per event, joined by a line; the first (latest) is highlighted. */
export function Timeline({ items }: { items: { key: string; title: string; detail?: string }[] }) {
  return (
    <View>
      {items.map((it, i) => (
        <View key={it.key} style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ alignItems: 'center', width: 14 }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, marginTop: 3, backgroundColor: i === 0 ? colors.brand600 : colors.surface, borderWidth: 2, borderColor: i === 0 ? colors.brand100 : colors.line }} />
            {i < items.length - 1 ? <View style={{ flex: 1, width: 2, backgroundColor: colors.lineSoft, marginVertical: 2 }} /> : null}
          </View>
          <View style={{ flex: 1, paddingBottom: i < items.length - 1 ? 14 : 0 }}>
            <Text style={{ fontSize: 14, fontFamily: i === 0 ? fonts.bold : fonts.semibold, color: colors.ink }}>{it.title}</Text>
            {it.detail ? <Text style={{ fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 }}>{it.detail}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}
