import { Stack } from 'expo-router';
import { Text } from 'react-native';
import { api } from '@/api/client';
import { ActionButton, Card, markRead, Page, QueryState } from '@/components/kit';
import { timeAgo } from '@/lib/format';
import { colors } from '@/lib/theme';
import { useQuery } from '@/lib/useQuery';

type N = { id: string; title: string; message: string; createdAt: string; readAt: string | null };

/** Shared by every role: the backend returns only the caller's own notifications. */
export default function Notifications() {
  const q = useQuery<{ unread: number; items: N[] }>('/notifications?pageSize=50', { pollMs: 60_000 });
  return (
    <Page title="Notifications" subtitle={q.data ? `${q.data.unread} unread` : undefined} refreshing={q.refreshing} onRefresh={q.refresh}>
      <Stack.Screen options={{ headerShown: true, title: 'Notifications' }} />
      <QueryState loading={q.loading} error={q.error} empty={q.data?.items.length === 0} emptyText="No notifications yet" onRetry={q.reload} />
      {q.data && q.data.unread > 0 ? <ActionButton title="Mark all read" variant="secondary" action={() => api.put('/notifications/read-all')} success="All marked as read" onDone={q.reload} /> : null}
      {q.data?.items.map((n) => (
        <Card key={n.id} onPress={n.readAt ? undefined : () => void markRead(n.id).then(q.reload)} style={n.readAt ? undefined : { borderColor: colors.brand500 }}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>{n.title}</Text>
          <Text style={{ color: colors.ink }}>{n.message}</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>{timeAgo(n.createdAt)}{n.readAt ? '' : ' · tap to mark read'}</Text>
        </Card>
      ))}
    </Page>
  );
}
