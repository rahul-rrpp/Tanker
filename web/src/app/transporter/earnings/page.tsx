'use client';

import { BadgeIndianRupee } from 'lucide-react';
import { useState } from 'react';
import { DataTable } from '@/components/transporter/ui';
import { DemoBadge, EmptyState, ErrorBlock, LoadingBlock, PageHeader, StatCard, StatusBadge, Tabs } from '@/components/ui/kit';
import { Button } from '@/components/ui/primitives';
import { dateTimeIST, inr } from '@/lib/format';
import { SETTLEMENT_STATUS } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

export type Ledger = { allocationId: string; bookingCode: string; company: string; isDemo: boolean; agreedFreight: number; commission: number; commissionRule: string; commissionPercent: number | null; otherCharges: number; taxes: number; netPayable: number; paidAmount: number; balance: number; settlementId: string | null; settlementCode: string | null; settlementStatus: string; settlementDate: string | null; reference: string | null };
type Resp = { summary: Record<string, number>; items: Ledger[] };

const CARDS: [string, string][] = [['totalFreight', 'Total freight earned'], ['monthlyFreight', 'Monthly freight'], ['completedTripEarnings', 'Completed trip earnings'], ['pendingPayments', 'Pending payments'], ['settledAmount', 'Settled amount'], ['platformCommission', 'Platform commission'], ['outstandingSettlements', 'Outstanding settlements']];

export default function Page() {
  const { data, error, mutate } = useApi<Resp>('/transporters/me/earnings');
  const [tab, setTab] = useState<'all' | 'pending'>('all');
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock rows={6} />;
  const rows = tab === 'pending' ? data.items.filter((r) => r.balance > 0) : data.items;
  return (
    <>
      <PageHeader title="Earnings & payments" subtitle="From TankerLink’s settlement records. These figures are read-only." actions={<a href="/api/v1/transporters/me/statement.pdf" download><Button variant="secondary">Download statement</Button></a>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{CARDS.map(([k, l]) => <StatCard key={k} label={l} value={inr(data.summary[k])} icon={<BadgeIndianRupee className="h-5 w-5" />} />)}</div>
      <div className="mt-6"><Tabs tabs={[{ value: 'all', label: 'All earnings' }, { value: 'pending', label: 'Pending payments' }]} value={tab} onChange={setTab} /></div>
      <div className="mt-4">
        {rows.length === 0 ? <EmptyState title="No earnings yet">Earnings appear when a company confirms your offer.</EmptyState> : (
          <DataTable rows={rows} rowKey={(r) => r.allocationId} columns={[
            { key: 'b', label: 'Booking', render: (r) => <>{r.bookingCode} {r.isDemo && <DemoBadge />}</> }, { key: 'c', label: 'Company', render: (r) => r.company }, { key: 'f', label: 'Agreed freight', render: (r) => inr(r.agreedFreight) }, { key: 'co', label: 'Commission', render: (r) => inr(r.commission) }, { key: 'o', label: 'Other charges', render: (r) => inr(r.otherCharges) },
            { key: 'n', label: 'Net payable', render: (r) => <strong>{inr(r.netPayable)}</strong> }, { key: 'p', label: 'Paid', render: (r) => inr(r.paidAmount) }, { key: 'ba', label: 'Balance', render: (r) => inr(r.balance) }, { key: 's', label: 'Status', render: (r) => <StatusBadge map={SETTLEMENT_STATUS} value={r.settlementStatus} /> }, { key: 'd', label: 'Settled', render: (r) => dateTimeIST(r.settlementDate) },
          ]} />
        )}
      </div>
    </>
  );
}
