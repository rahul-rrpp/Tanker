import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { pageStyles as s } from '@/theme';

/** Label on the left, value on the right. */
export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value ?? '—'}</Text>
    </View>
  );
}
