import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { pageStyles as s } from '@/theme';

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={s.section}>{children}</Text>;
}
