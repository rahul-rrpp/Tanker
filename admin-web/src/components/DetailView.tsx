'use client';

import { useState } from 'react';
import type { DetailDef, DetailTab, Rec } from '@/config/types';
import { useApi } from '@/lib/api';
import { ActionBar } from './Actions';
import { AutoView } from './AutoView';
import { ErrorState, Loading, PageHeader, Section, StatusBadge, Tabs } from './ui';

function TabBody({ tab, id, data }: { tab: DetailTab; id: string; data: Rec }) {
  const remote = useApi<Rec>(tab.path ? tab.path(id) : null);
  if (tab.view) return <AutoView data={tab.view(data)} />;
  if (remote.error) return <ErrorState error={remote.error} onRetry={() => void remote.mutate()} />;
  if (!remote.data) return <Loading />;
  const d = remote.data;
  // Tab endpoints mostly return { items: [...] }; show the list directly.
  return <AutoView data={Object.keys(d).length === 1 && Array.isArray(d.items) ? d.items : d} />;
}

export function DetailView({ def, id, back }: { def: DetailDef; id: string; back: { href: string; label: string } }) {
  const { data, error, mutate } = useApi<Rec>(def.path(id));
  const tabs: DetailTab[] = [{ label: 'Overview' }, ...(def.tabs ?? [])];
  const [tab, setTab] = useState('Overview');
  if (error) return <><PageHeader title="Not available" back={back} /><ErrorState error={error} onRetry={() => void mutate()} /></>;
  if (!data) return <Loading />;
  const record = def.record ? def.record(data) : data;
  const status = def.status?.(data);
  const active = tabs.find((t) => t.label === tab) ?? tabs[0];
  return (
    <>
      <PageHeader
        back={back}
        title={<span className="flex flex-wrap items-center gap-3">{def.title(data)}{status && <StatusBadge value={status} />}</span>}
        subtitle={def.subtitle?.(data)}
        actions={<ActionBar actions={def.actions} record={record} onDone={() => void mutate()} />}
      />
      {tabs.length > 1 && <div className="mb-4"><Tabs tabs={tabs.map((t) => ({ value: t.label, label: t.label }))} value={active.label} onChange={setTab} /></div>}
      <Section>{active.label === 'Overview' ? <AutoView data={data} /> : <TabBody key={active.label} tab={active} id={id} data={data} />}</Section>
    </>
  );
}
