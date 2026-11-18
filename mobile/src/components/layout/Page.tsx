import type { ReactElement, ReactNode } from 'react';
import { FlatList, RefreshControl, ScrollView, View, type FlatListProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T } from '@/components/ui/Txt';
import { colors, layout } from '@/theme';

type HeaderProps = { title: string; subtitle?: string; eyebrow?: string; right?: ReactNode };

/** Left-aligned editorial page header: optional eyebrow, large Archivo title, quiet subtitle. */
export function PageHeader({ title, subtitle, eyebrow, right }: HeaderProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingTop: 8, paddingBottom: 6 }}>
      <View style={{ flex: 1, gap: 4 }}>
        {eyebrow ? <T v="eyebrow" c="muted">{eyebrow}</T> : null}
        <T v="title" accessibilityRole="header">{title}</T>
        {subtitle ? <T v="label" c="muted">{subtitle}</T> : null}
      </View>
      {right}
    </View>
  );
}

/** Scrollable page for the signed-in apps, on paper, with the editorial header and pull-to-refresh. */
export function Page({ title, subtitle, eyebrow, children, refreshing, onRefresh, right, footer, gap = 14 }: HeaderProps & { children: ReactNode; refreshing?: boolean; onRefresh?: () => void; footer?: ReactNode; gap?: number }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40, gap }}
        refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.ink} colors={[colors.ink]} /> : undefined}
        keyboardShouldPersistTaps="handled"
      >
        <PageHeader title={title} subtitle={subtitle} eyebrow={eyebrow} right={right} />
        {children}
      </ScrollView>
      {footer}
    </SafeAreaView>
  );
}

/**
 * Same page, virtualised: for long lists (bookings, trips, offers). `top` renders above the rows
 * (tabs, loading/empty state) and scrolls with them.
 */
export function ListPage<T>({ title, subtitle, eyebrow, right, top, refreshing, onRefresh, ...list }: HeaderProps & { top?: ReactElement; refreshing?: boolean; onRefresh?: () => void } & Omit<FlatListProps<T>, 'ListHeaderComponent' | 'refreshControl'>) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <FlatList
        {...list}
        contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 4 }}>
            <PageHeader title={title} subtitle={subtitle} eyebrow={eyebrow} right={right} />
            {top}
          </View>
        }
        refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.ink} colors={[colors.ink]} /> : undefined}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={10}
        windowSize={7}
      />
    </SafeAreaView>
  );
}
