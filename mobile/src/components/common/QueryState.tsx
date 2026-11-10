import { ActivityIndicator, Text, View } from 'react-native';
import { Banner, Button } from '@/components/ui';
import { colors, pageStyles as s } from '@/theme';

/** Loading, error and empty handling for any query. Renders nothing once data is ready. */
export function QueryState({ loading, error, empty, emptyText = 'Nothing here yet', onRetry }: { loading: boolean; error: string | null; empty?: boolean; emptyText?: string; onRetry?: () => void }) {
  if (loading) return <ActivityIndicator style={{ marginTop: 32 }} color={colors.brand600} accessibilityLabel="Loading" />;
  if (error) return <View style={{ gap: 8 }}><Banner>{error}</Banner>{onRetry ? <Button title="Try again" variant="secondary" onPress={onRetry} /> : null}</View>;
  if (empty) return <Text style={s.empty}>{emptyText}</Text>;
  return null;
}
