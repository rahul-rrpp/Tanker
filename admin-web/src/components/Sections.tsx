'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import type { ColumnDef, ItemsSection, KvSection, PageDef, Rec, SectionDef, TableSection } from '@/config/types';
import { qs, useApi } from '@/lib/api';
import type { Format } from '@/lib/format';
import { ActionBar, ActionButton } from './Actions';
import { AutoView } from './AutoView';
import { DataTable } from './DataTable';
import { useCan } from './Shell';
import { Button, ErrorState, Input, Loading, PageHeader, Pagination, Section, Stat, Tabs } from './ui';

type Listing = { items: Rec[]; total: number; page: number; pageSize: number; columns?: { key: string; label: string; format: Format }[] };

function TableView({ s }: { s: TableSection }) {
  const can = useCan();
  const [tab, setTab] = useState(s.filter?.tabs[0]?.value ?? '');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const params = { ...s.query, ...(s.filter ? { [s.filter.param]: tab } : {}), q, from, to };
  const { data, error, mutate } = useApi<Listing>(`${s.path}${qs({ ...params, page, pageSize: 20 })}`, { keepPreviousData: true });
  const exportUrl = (format: 'xlsx' | 'pdf') => `/api/v1${s.path}${qs({ ...params, format })}`;
  const module = s.path.split('/')[2];
  const reload = () => void mutate();
  const columns: ColumnDef[] | undefined = data?.columns?.map((c) => ({ key: c.key, label: c.label, format: c.format }));
  return (
    <Section
      title={s.title}
      actions={
        <>
          <ActionBar actions={s.actions} record={{}} onDone={reload} />
          {s.exportable !== false && can(`${module}.export`) && (
            <>
              <a href={exportUrl('xlsx')}><Button size="sm" variant="secondary"><Download className="h-3.5 w-3.5" />Excel</Button></a>
              <a href={exportUrl('pdf')}><Button size="sm" variant="secondary"><Download className="h-3.5 w-3.5" />PDF</Button></a>
            </>
          )}
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-64"><Input label="Search" placeholder="Name, code, phone…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        {s.dateRange !== false && (
          <>
            <div className="w-40"><Input label="From" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></div>
            <div className="w-40"><Input label="To" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></div>
          </>
        )}
      </div>
      {s.filter && <div className="mb-4"><Tabs tabs={s.filter.tabs} value={tab} onChange={(v) => { setTab(v); setPage(1); }} /></div>}
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading /> : (
        <>
          <DataTable rows={data.items} columns={columns} rowHref={s.rowHref} actions={s.rowActions ? (r) => s.rowActions!.map((a) => <ActionButton key={a.label} action={a} record={r} onDone={reload} />) : undefined} />
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
        </>
      )}
    </Section>
  );
}

function ItemsView({ s }: { s: ItemsSection }) {
  const [tab, setTab] = useState(s.filter?.tabs[0]?.value ?? '');
  const [page, setPage] = useState(1);
  const path = `${s.path}${qs({ ...(s.filter ? { [s.filter.param]: tab } : {}), ...(s.paged ? { page, pageSize: 25 } : {}) })}`;
  const { data, error, mutate } = useApi<Rec>(path, { keepPreviousData: true });
  const reload = () => void mutate();
  const rows = (data?.[s.dataKey ?? 'items'] as Rec[] | undefined) ?? [];
  return (
    <Section title={s.title} actions={<ActionBar actions={s.actions} record={{}} onDone={reload} />}>
      {s.stats && data && <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{s.stats(data).map((x) => <Stat key={x.label} label={x.label} value={x.value} />)}</div>}
      {s.filter && <div className="mb-4"><Tabs tabs={s.filter.tabs} value={tab} onChange={(v) => { setTab(v); setPage(1); }} /></div>}
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading /> : (
        <>
          <DataTable rows={rows} columns={s.columns} rowHref={s.rowHref} actions={s.rowActions ? (r) => s.rowActions!.map((a) => <ActionButton key={a.label} action={a} record={r} onDone={reload} />) : undefined} />
          {s.paged && typeof data.total === 'number' && <Pagination page={page} pageSize={25} total={data.total as number} onChange={setPage} />}
        </>
      )}
    </Section>
  );
}

function KvView({ s }: { s: KvSection }) {
  const { data, error, mutate } = useApi<Rec>(s.path);
  const reload = () => void mutate();
  const value = data ? (s.dataKey ? data[s.dataKey] : data) : null;
  return (
    <Section title={s.title} actions={value ? <ActionBar actions={s.actions} record={value as Rec} onDone={reload} /> : null}>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading /> : <AutoView data={value} />}
    </Section>
  );
}

export function SectionView({ s }: { s: SectionDef }) {
  if (s.kind === 'table') return <TableView s={s} />;
  if (s.kind === 'items') return <ItemsView s={s} />;
  return <KvView s={s} />;
}

export function PageView({ page }: { page: PageDef }) {
  return (
    <>
      <PageHeader title={page.title} subtitle={page.subtitle} />
      <div className="space-y-6">{page.sections.map((s, i) => <SectionView key={`${s.path}-${i}`} s={s} />)}</div>
    </>
  );
}
