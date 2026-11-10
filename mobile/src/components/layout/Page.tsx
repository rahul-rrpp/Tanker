import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, pageStyles as s } from '@/theme';

/** Scrollable page for the signed-in apps, with a title row and pull-to-refresh. */
export function Page({ title, subtitle, children, refreshing, onRefresh, right }: { title: string; subtitle?: string; children: ReactNode; refreshing?: boolean; onRefresh?: () => void; right?: ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }} refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} /> : undefined} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.title} accessibilityRole="header">{title}</Text>
            {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
          </View>
          {right}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
