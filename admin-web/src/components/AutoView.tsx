'use client';

import type { Rec } from '@/config/types';
import { formatValue, guessFormat, humanize, isStatusKey, labelOf } from '@/lib/format';
import { DataTable } from './DataTable';
import { Empty, KV, StatusBadge } from './ui';

const SKIP = /^(id|.*Id|passwordHash|routePolyline|logoKey|storageKey|.*Polyline|version|columns)$/;

const isPlain = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const isRowList = (v: unknown): v is Rec[] => Array.isArray(v) && (v.length === 0 || (typeof v[0] === 'object' && v[0] !== null));

function show(key: string, v: unknown) {
  if (typeof v === 'string' && isStatusKey(key)) return <StatusBadge value={v} />;
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'object' ? labelOf(x) : String(x))).join(', ') : '—';
  return formatValue(v, guessFormat(key, v));
}

/**
 * Renders any API payload readably: plain fields as a grid, lists of records as tables, nested
 * objects as their own titled blocks. Used where a hand-made layout would add little.
 */
export function AutoView({ data, depth = 0 }: { data: unknown; depth?: number }) {
  if (data === null || data === undefined) return <Empty title="No details" />;
  if (isRowList(data)) return <DataTable rows={data} />;
  if (typeof data !== 'object') return <p className="text-sm">{String(data)}</p>;

  const entries = Object.entries(data as Rec).filter(([k]) => !SKIP.test(k));
  const counts = (data as Rec)._count as Rec | undefined;
  const plain = entries.filter(([k, v]) => k !== '_count' && (isPlain(v) || (Array.isArray(v) && !isRowList(v)) || (typeof v === 'object' && v !== null && !Array.isArray(v) && depth > 0 && labelOf(v) !== '…')));
  const nested = entries.filter(([k, v]) => k !== '_count' && v && typeof v === 'object' && !Array.isArray(v) && !plain.some(([p]) => p === k));
  const lists = entries.filter(([, v]) => isRowList(v) && (v as Rec[]).length > 0);
  const emptyLists = entries.filter(([, v]) => isRowList(v) && (v as Rec[]).length === 0).map(([k]) => humanize(k));

  return (
    <div className="space-y-5">
      {(plain.length > 0 || counts) && (
        <KV items={[...plain.map(([k, v]) => ({ label: humanize(k), value: show(k, v) })), ...Object.entries(counts ?? {}).map(([k, v]) => ({ label: `${humanize(k)} (count)`, value: String(v) }))]} />
      )}
      {nested.map(([k, v]) => (
        <div key={k} className={depth === 0 ? 'rounded-xl border border-line p-4' : 'border-l-2 border-line pl-4'}>
          <h3 className="mb-3 text-sm font-semibold text-ink">{humanize(k)}</h3>
          <AutoView data={v} depth={depth + 1} />
        </div>
      ))}
      {lists.map(([k, v]) => (
        <div key={k}>
          <h3 className="mb-2 text-sm font-semibold text-ink">{humanize(k)} <span className="font-normal text-muted">({(v as Rec[]).length})</span></h3>
          <DataTable rows={v as Rec[]} />
        </div>
      ))}
      {emptyLists.length > 0 && <p className="text-xs text-muted">No records yet: {emptyLists.join(', ')}.</p>}
    </div>
  );
}
