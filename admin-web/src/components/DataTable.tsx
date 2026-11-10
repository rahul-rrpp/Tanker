'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import type { ColumnDef, Rec } from '@/config/types';
import { formatValue, guessFormat, humanize, isStatusKey, labelOf } from '@/lib/format';
import { Empty, StatusBadge } from './ui';

const HIDDEN = /^(id|.*Id|.*Ids|passwordHash|routePolyline|logoKey|storageKey|metadata|.*Polyline|isDemo|version)$/;

/** Columns for rows whose endpoint does not describe them: primitive fields first, up to 8. */
export function autoColumns(rows: Rec[]): ColumnDef[] {
  const first = rows[0];
  if (!first) return [];
  const keys = Object.keys(first).filter((k) => !HIDDEN.test(k));
  const score = (k: string) => {
    const v = first[k];
    if (/(code|number|name|title)$/i.test(k)) return 0;
    if (isStatusKey(k)) return 2;
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) return 1;
    if (typeof v === 'object' && !Array.isArray(v) && labelOf(v) !== '…') return 1;
    return 9;
  };
  return keys.filter((k) => score(k) < 9).sort((a, b) => score(a) - score(b)).slice(0, 8).map((key) => ({ key, label: humanize(key), format: guessFormat(key, first[key]) }));
}

export function Cell({ col, row }: { col: ColumnDef; row: Rec }): ReactNode {
  if (col.render) return col.render(row);
  const v = row[col.key];
  if (typeof v === 'string' && isStatusKey(col.key)) return <StatusBadge value={v} />;
  return formatValue(v, col.format ?? guessFormat(col.key, v));
}

export function DataTable({ rows, columns, rowHref, actions, empty }: { rows: Rec[]; columns?: ColumnDef[]; rowHref?: (r: Rec) => string; actions?: (r: Rec) => ReactNode; empty?: string }) {
  const router = useRouter();
  const cols = columns?.length ? columns : autoColumns(rows);
  if (!rows.length) return <Empty title={empty ?? 'No records'} />;
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-canvas text-xs uppercase tracking-wide text-muted">
          <tr>{cols.map((c) => <th key={c.key} className="whitespace-nowrap px-3 py-2.5 font-medium">{c.label}</th>)}{actions && <th className="px-3 py-2.5" />}</tr>
        </thead>
        <tbody className="divide-y divide-line bg-white">
          {rows.map((r, i) => (
            <tr key={(r.id as string) ?? i} onClick={rowHref ? () => router.push(rowHref(r)) : undefined} className={rowHref ? 'cursor-pointer hover:bg-brand-50/40' : undefined}>
              {cols.map((c) => <td key={c.key} className="px-3 py-2.5 align-top text-ink">{<Cell col={c} row={r} />}</td>)}
              {actions && <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}><div className="flex justify-end gap-1.5">{actions(r)}</div></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
