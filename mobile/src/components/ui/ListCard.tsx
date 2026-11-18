import type { ReactNode } from 'react';
import { LedgerRow } from './Ledger';

/**
 * Older list-item API, now drawn as a ledger row (no card per item). Screens that still use it get the
 * Manifest look; new screens use LedgerRow directly (it adds the date column and attention flag).
 */
export function ListCard(props: {
  code?: string;
  status?: ReactNode;
  from?: string | null;
  to?: string | null;
  title?: string;
  meta?: (string | null | undefined | false)[];
  amount?: string;
  amountLabel?: string;
  note?: string | null;
  onPress?: () => void;
  children?: ReactNode;
}) {
  const { note, meta, ...rest } = props;
  return <LedgerRow {...rest} meta={[...(meta ?? []), note]} />;
}
