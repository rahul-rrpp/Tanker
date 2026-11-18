import { Stack } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { ENDPOINTS } from '@/services/api';
import { ActionButton, QueryState } from '@/components/common';
import { T } from '@/components/ui';
import { markRead, notificationsService } from '@/features/notifications/services/notificationsService';
import { Page } from '@/components/layout';
import { timeAgo } from '@/utils/format';
import { colors } from '@/theme';
import { useQuery } from '@/hooks';

type N = { id: string; title: string; message: string; createdAt: string; readAt: string | null };

/** Shared by every role: the backend returns only the caller's own notifications. A plain feed; unread in bold with a signal dot. */
export default function NotificationsScreen() {
  const q = useQuery<{ unread: number; items: N[] }>(ENDPOINTS.notifications.list, { pollMs: 60_000 });
  const items = q.data?.items ?? [];
  return (
    <Page
      title="Notifications"
      subtitle={q.data ? (q.data.unread ? `${q.data.unread} unread` : 'All caught up') : undefined}
      refreshing={q.refreshing}
      onRefresh={q.refresh}
      right={q.data && q.data.unread > 0 ? <View style={{ width: 132 }}><ActionButton title="Mark all read" variant="ghost" action={() => notificationsService.markAllRead()} success="All marked as read" onDone={q.reload} /></View> : undefined}
      gap={0}
    >
      <Stack.Screen options={{ headerShown: true, title: '', headerShadowVisible: false, headerStyle: { backgroundColor: colors.paper } }} />
      <View style={{ height: 12 }} />
      <QueryState loading={q.loading} error={q.error} skeleton="feed" empty={q.data?.items.length === 0} emptyText="No notifications yet" emptyIcon="notifications-off-outline" onRetry={q.reload} />
      {items.map((n, i) => {
        const unread = !n.readAt;
        return (
          <Pressable
            key={n.id}
            onPress={unread ? () => void markRead(n.id).then(q.reload) : undefined}
            disabled={!unread}
            accessibilityRole={unread ? 'button' : undefined}
            accessibilityHint={unread ? 'Marks this notification as read' : undefined}
            style={({ pressed }) => [styles.row, i === 0 && styles.first, pressed && { backgroundColor: colors.neutralBg }]}
          >
            <View style={{ width: 10, paddingTop: 7 }}>{unread ? <View style={styles.dot} /> : null}</View>
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                <T v={unread ? 'bodyStrong' : 'body'} style={{ flex: 1 }}>{n.title}</T>
                <T v="code" c="faint">{timeAgo(n.createdAt)}</T>
              </View>
              <T v="label" c="muted">{n.message}</T>
            </View>
          </Pressable>
        );
      })}
    </Page>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  first: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
});
