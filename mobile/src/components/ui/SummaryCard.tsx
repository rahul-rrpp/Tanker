import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Figure, Perforation, Waybill } from './Manifest';
import { RouteRail } from './RouteLine';
import { T } from './Txt';

/**
 * Head of a detail screen, drawn as a waybill: code + status, the route rail with addresses, a tear-off
 * line, then the key figure. Children (actions) go under the figure.
 */
export function SummaryCard({
  code,
  status,
  from,
  to,
  fromDetail,
  toDetail,
  amountLabel,
  amount,
  amountNote,
  distanceKm,
  duration,
  progress,
  children,
}: {
  code?: string;
  status?: ReactNode;
  from?: string | null;
  to?: string | null;
  fromDetail?: string | null;
  toDetail?: string | null;
  amountLabel?: string;
  amount?: string;
  amountNote?: string;
  distanceKm?: number | string | null;
  duration?: string | null;
  progress?: number | null;
  children?: ReactNode;
}) {
  return (
    <Waybill style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <T v="code" c="muted">{code ?? ''}</T>
        {status}
      </View>
      {from !== undefined || to !== undefined ? <RouteRail from={from} to={to} fromDetail={fromDetail} toDetail={toDetail} distanceKm={distanceKm} duration={duration} progress={progress} /> : null}
      {amount ? (
        <>
          <Perforation />
          <Figure label={amountLabel ?? 'Amount'} value={amount} note={amountNote} />
        </>
      ) : null}
      {children ? <View style={{ gap: 10 }}>{children}</View> : null}
    </Waybill>
  );
}
