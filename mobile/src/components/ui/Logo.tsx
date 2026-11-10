import { Text, View } from 'react-native';
import { colors } from '@/theme';

/** Simple vector-free brand mark (tanker silhouette built from views). */
export function Logo({ inverted, size = 48 }: { inverted?: boolean; size?: number }) {
  const s = size / 40;
  return (
    <View style={{ alignItems: 'center' }} accessibilityRole="image" accessibilityLabel="TTMS logo">
      <View style={{ width: 40 * s, height: 40 * s, borderRadius: 10 * s, backgroundColor: inverted ? colors.white : colors.brand600 }}>
        <View style={{ position: 'absolute', left: 7 * s, top: 13 * s, width: 18 * s, height: 11 * s, borderRadius: 5.5 * s, backgroundColor: inverted ? colors.brand600 : colors.white }} />
        <View style={{ position: 'absolute', left: 25 * s, top: 16 * s, width: 8 * s, height: 8 * s, borderTopRightRadius: 3 * s, backgroundColor: colors.accentLight }} />
        <View style={{ position: 'absolute', left: 10 * s, top: 24 * s, width: 6 * s, height: 6 * s, borderRadius: 3 * s, backgroundColor: inverted ? colors.brand900 : colors.brand900 }} />
        <View style={{ position: 'absolute', left: 25 * s, top: 24 * s, width: 6 * s, height: 6 * s, borderRadius: 3 * s, backgroundColor: colors.brand900 }} />
      </View>
      <Text style={{ marginTop: 10, fontSize: 22 * Math.max(1, s / 1.4), fontWeight: '800', letterSpacing: 1, color: inverted ? colors.white : colors.ink }}>TTMS</Text>
    </View>
  );
}
