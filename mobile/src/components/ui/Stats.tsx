import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { colors, pageStyles as s } from '@/theme';
import type { IconName } from '@/types';

/** Two-column grid of KPI tiles. */
export function Stats({ items }: { items: { label: string; value: ReactNode; icon?: IconName }[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {items.map((i) => (
        <View key={i.label} style={s.stat}>
          {i.icon ? <Ionicons name={i.icon} size={18} color={colors.brand600} /> : null}
          <Text style={s.statValue} numberOfLines={1}>{i.value}</Text>
          <Text style={s.statLabel} numberOfLines={2}>{i.label}</Text>
        </View>
      ))}
    </View>
  );
}
