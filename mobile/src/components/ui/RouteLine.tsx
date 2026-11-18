import { View } from 'react-native';
import { colors } from '@/theme';
import { km as fmtKm } from '@/utils/format';
import { T } from './Txt';

/** Origin = hollow ink ring, destination = solid ink square: readable without colour. */
function Origin({ size = 10 }: { size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.paper }} />;
}
function Destination({ size = 10 }: { size?: number }) {
  return <View style={{ width: size, height: size, backgroundColor: colors.ink }} />;
}

/**
 * Compact route for rows: "Pune → Mumbai" style, stacked when space is tight.
 * Kept for older screens; the signature is unchanged.
 */
export function RouteLine({ from, to, fromDetail, toDetail, size = 'md' }: { from?: string | null; to?: string | null; fromDetail?: string | null; toDetail?: string | null; size?: 'md' | 'lg' }) {
  if (size === 'lg' || fromDetail || toDetail) return <RouteRail from={from} to={to} fromDetail={fromDetail} toDetail={toDetail} />;
  return (
    <View style={{ gap: 6 }} accessibilityLabel={`From ${from ?? 'unknown'} to ${to ?? 'unknown'}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Origin size={8} />
        <T v="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{from || '—'}</T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Destination size={8} />
        <T v="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{to || '—'}</T>
      </View>
    </View>
  );
}

/**
 * The waybill route: a vertical rail from origin to destination, the distance written on the rail,
 * addresses under each stop. `progress` (0..1) draws the travelled part in ink and places a live
 * orange marker where the tanker is.
 */
export function RouteRail({ from, to, fromDetail, toDetail, distanceKm, duration, progress }: { from?: string | null; to?: string | null; fromDetail?: string | null; toDetail?: string | null; distanceKm?: number | string | null; duration?: string | null; progress?: number | null }) {
  const p = progress === null || progress === undefined ? null : Math.max(0, Math.min(1, progress));
  const meta = [distanceKm !== null && distanceKm !== undefined ? fmtKm(distanceKm) : null, duration].filter(Boolean).join(' · ');
  return (
    <View style={{ flexDirection: 'row', gap: 14 }} accessibilityLabel={`From ${from ?? 'unknown'} to ${to ?? 'unknown'}${meta ? `, ${meta}` : ''}`}>
      <View style={{ width: 14, alignItems: 'center', paddingTop: 6 }}>
        <Origin size={12} />
        <View style={{ flex: 1, width: 2, marginVertical: 4, backgroundColor: colors.line, minHeight: 44 }}>
          {p !== null ? <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: `${p * 100}%`, backgroundColor: colors.ink }} /> : null}
          {p !== null && p > 0 && p < 1 ? (
            <View style={{ position: 'absolute', top: `${p * 100}%`, left: -5, width: 12, height: 12, marginTop: -6, borderRadius: 6, backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.paper }} />
          ) : null}
        </View>
        <Destination size={12} />
      </View>
      <View style={{ flex: 1, justifyContent: 'space-between', gap: 14 }}>
        <View style={{ gap: 2 }}>
          <T v="heading" numberOfLines={1}>{from || '—'}</T>
          {fromDetail ? <T v="caption" c="muted" numberOfLines={2}>{fromDetail}</T> : null}
        </View>
        {meta ? <T v="code" c="muted">{meta}</T> : null}
        <View style={{ gap: 2 }}>
          <T v="heading" numberOfLines={1}>{to || '—'}</T>
          {toDetail ? <T v="caption" c="muted" numberOfLines={2}>{toDetail}</T> : null}
        </View>
      </View>
    </View>
  );
}
