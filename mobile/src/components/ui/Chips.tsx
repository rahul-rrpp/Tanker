import { Pressable, ScrollView, Text, View } from 'react-native';
import { colors, fonts, layout } from '@/theme';

/**
 * Filter tabs as an editorial index: plain words on the paper, the selected one in ink with a short
 * rule underneath, optional counts in mono. Scrolls horizontally; bleeds to the screen edges.
 */
export function Chips<T extends string>({ value, options, onChange, counts, bleed = true }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; counts?: Partial<Record<T, number>>; bleed?: boolean }) {
  return (
    <View style={{ marginHorizontal: bleed ? -layout.gutter : 0, borderBottomWidth: 1, borderBottomColor: colors.line }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 22, paddingHorizontal: bleed ? layout.gutter : 0 }}>
        {options.map((o) => {
          const on = o.value === value;
          const n = counts?.[o.value];
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              hitSlop={{ top: 8, bottom: 4 }}
              style={{ paddingTop: 10, paddingBottom: 11, borderBottomWidth: 2, borderBottomColor: on ? colors.ink : 'transparent', marginBottom: -1, flexDirection: 'row', alignItems: 'baseline', gap: 5 }}
            >
              <Text style={{ fontFamily: on ? fonts.semibold : fonts.medium, fontSize: 14, color: on ? colors.ink : colors.muted }} numberOfLines={1}>{o.label}</Text>
              {n !== undefined ? <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: on ? colors.ink : colors.faint }}>{n}</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
