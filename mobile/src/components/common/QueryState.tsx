import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { Banner, Button, SkeletonFor, T, type SkeletonKind } from '@/components/ui';
import { colors } from '@/theme';
import type { IconName } from '@/types';

/**
 * Nothing-here state: a line icon, a short statement in the heading face, and a hint about what will
 * fill this space. Quiet on purpose; it should explain, not decorate.
 */
export function EmptyState({ text, icon = 'file-tray-outline', hint }: { text: string; icon?: IconName; hint?: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 44, paddingHorizontal: 12, gap: 8 }}>
      <Ionicons name={icon} size={28} color={colors.faint} />
      <T v="subheading" align="center" style={{ marginTop: 4 }}>{text}</T>
      {hint ? <T v="label" c="muted" align="center" style={{ maxWidth: 290 }}>{hint}</T> : null}
    </View>
  );
}

/**
 * Loading, error and empty handling for any query. Renders nothing once data is ready.
 * While loading it shows a skeleton shaped like the content (`skeleton`, default list cards), or nothing
 * when `skeleton="none"` (the screen draws its own).
 */
export function QueryState({ loading, error, empty, emptyText = 'Nothing here yet', emptyIcon, onRetry, skeleton = 'list', skeletonCount }: { loading: boolean; error: string | null; empty?: boolean; emptyText?: string; emptyIcon?: IconName; onRetry?: () => void; skeleton?: SkeletonKind | 'none'; skeletonCount?: number }) {
  if (loading) return skeleton === 'none' ? null : <SkeletonFor kind={skeleton} count={skeletonCount} />;
  if (error) return <View style={{ gap: 8 }}><Banner>{error}</Banner>{onRetry ? <Button title="Try again" icon="refresh" variant="secondary" onPress={onRetry} /> : null}</View>;
  if (empty) return <EmptyState text={emptyText} icon={emptyIcon} />;
  return null;
}
