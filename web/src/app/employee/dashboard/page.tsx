'use client';

import { Activity } from 'lucide-react';
import { ErrorBlock, LoadingBlock, PageHeader, SectionTitle, StatCard } from '@/components/ui/kit';
import { humanize, inr } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type D = { common: Record<string, number>; sections: Record<string, Record<string, number>> };
const label = (k: string) => humanize(k.replace(/([A-Z])/g, '_$1'));
const TITLE: Record<string, string> = { sales: 'Sales', operations: 'Operations', verification: 'Verification', accounts: 'Accounts', support: 'Customer support' };
const MONEY = new Set(['pendingCollections', 'paymentsReceived']);

export default function Page() {
  const { data, error, mutate } = useApi<D>('/employee/dashboard', { refreshInterval: 60_000 });
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock rows={8} />;
  const grid = (o: Record<string, number>) => <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{Object.entries(o).map(([k, v]) => <StatCard key={k} label={label(k)} value={MONEY.has(k) ? inr(v) : v} icon={<Activity className="h-5 w-5" />} />)}</div>;
  return (
    <>
      <PageHeader title="My dashboard" subtitle="Calculated live from your records" />
      {grid(data.common)}
      {Object.entries(data.sections).map(([k, v]) => <section key={k} className="mt-8"><SectionTitle>{TITLE[k] ?? k}</SectionTitle>{grid(v)}</section>)}
    </>
  );
}
