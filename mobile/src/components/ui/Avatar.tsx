import { Text, View } from 'react-native';
import { colors, fonts } from '@/theme';

/** Initials on an ink disc (or a translucent disc on dark surfaces). */
export function Avatar({ name, size = 40, onDark }: { name: string; size?: number; onDark?: boolean }) {
  const initials = name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?';
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: onDark ? 'rgba(255,255,255,0.12)' : colors.ink, alignItems: 'center', justifyContent: 'center' }}
      accessibilityLabel={name}
    >
      <Text style={{ color: colors.white, fontFamily: fonts.displayBold, fontSize: size * 0.36, letterSpacing: 0.3 }}>{initials}</Text>
    </View>
  );
}
