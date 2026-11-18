import { Pressable, Text, View } from 'react-native';
import { colors, pageStyles as s, fonts } from '@/theme';
import type { IconName } from '@/types';
import { IconBadge, type BadgeTone } from './IconBadge';

/** A row of up to four big shortcut tiles (icon above label). */
export function QuickActions({ items }: { items: { label: string; icon: IconName; tone?: BadgeTone; onPress: () => void; disabled?: boolean }[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {items.map((a) => (
        <Pressable
          key={a.label}
          onPress={a.onPress}
          disabled={a.disabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: a.disabled }}
          style={({ pressed }) => [s.stat, { flexBasis: 0, alignItems: 'center', paddingVertical: 14, gap: 8 }, pressed && { opacity: 0.85 }, a.disabled && { opacity: 0.45 }]}
        >
          <IconBadge icon={a.icon} tone={a.tone ?? 'brand'} size={42} />
          <Text style={{ fontSize: 12, fontFamily: fonts.bold, color: colors.ink, textAlign: 'center' }} numberOfLines={2}>{a.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
