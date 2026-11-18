import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/Avatar';
import { useStatusBarStyle } from '@/hooks/useStatusBarStyle';
import { ROUTES } from '@/navigation/routes';
import { colors, fonts } from '@/theme';

/**
 * Home-screen layout: a navy hero header (eyebrow, title, subtitle, notifications and avatar) with
 * soft decorative depth; the content scrolls up over its rounded bottom edge.
 */
export function HeroPage({
  eyebrow,
  title,
  subtitle,
  avatarName,
  heroExtra,
  children,
  refreshing,
  onRefresh,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  avatarName?: string;
  /** Rendered inside the hero, under the subtitle (e.g. a primary action). */
  heroExtra?: ReactNode;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  useStatusBarStyle('light');
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.white} progressViewOffset={insets.top} /> : undefined}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ backgroundColor: colors.brand900, paddingTop: insets.top + 14, paddingHorizontal: 20, paddingBottom: 64, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, overflow: 'hidden' }}>
        {/* Decorative light: two large soft discs for depth. */}
        <View pointerEvents="none" style={{ position: 'absolute', width: 260, height: 260, borderRadius: 130, backgroundColor: colors.brand600, opacity: 0.35, top: -90, right: -70 }} />
        <View pointerEvents="none" style={{ position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: colors.brand500, opacity: 0.18, bottom: -60, left: -50 }} />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}>
            {eyebrow ? <Text style={{ color: colors.brand100, fontSize: 13, fontFamily: fonts.semibold, opacity: 0.85 }}>{eyebrow}</Text> : null}
          </View>
          <Pressable onPress={() => router.push(ROUTES.notifications)} accessibilityRole="button" accessibilityLabel="Notifications" hitSlop={8} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="notifications-outline" size={20} color={colors.white} />
          </Pressable>
          {avatarName ? <Avatar name={avatarName} size={42} onDark /> : null}
        </View>
        <Text style={{ color: colors.white, fontSize: 26, fontFamily: fonts.display, letterSpacing: -0.5, marginTop: 14 }} accessibilityRole="header" numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={{ fontFamily: fonts.regular, color: colors.brand100, fontSize: 14, marginTop: 4, opacity: 0.9 }}>{subtitle}</Text> : null}
        {heroExtra ? <View style={{ marginTop: 18 }}>{heroExtra}</View> : null}
      </View>
      <View style={{ marginTop: -44, paddingHorizontal: 16, gap: 14 }}>{children}</View>
    </ScrollView>
  );
}
