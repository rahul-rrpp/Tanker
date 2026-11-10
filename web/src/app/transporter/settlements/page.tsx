'use client';

import Link from 'next/link';
import { DataTable, FileLinks } from '@/components/transporter/ui';
import { DemoBadge, EmptyState, ErrorBlock, LoadingBlock, PageHeader, StatusBadge } from '@/components/ui/kit';
import { Button } from '@/components/ui/primitives';
import { dateTimeIST, inr } from '@/lib/format';
import { SETTLEMENT_STATUS } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';
import type { Ledger } from '../earnings/page';

export default function Page() {
  const { data, error, mutate } = useApi<{ items: Ledger[] }>('/transporters/me/settlements');
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  return (
    <>
      <PageHeader title="Commission & settlements" subtitle="Commission follows the platform rule in force when the booking was confirmed" />
      {data.items.length === 0 ? <EmptyState title="No settlements yet" /> : (
        <DataTable rows={data.items} rowKey={(r) => r.allocationId} columns={[
          { key: 'c', label: 'Settlement', render: (r) => <>{r.settlementCode} {r.isDemo && <DemoBadge />}<span className="block text-xs text-muted">{r.bookingCode}</span></> }, { key: 'f', label: 'Booking freight', render: (r) => inr(r.agreedFreight) }, { key: 'p', label: 'Commission %', render: (r) => (r.commissionPercent === null ? 'Fixed' : `${r.commissionPercent}%`) }, { key: 'co', label: 'Commission', render: (r) => inr(r.commission) },
          { key: 't', label: 'Taxes', render: (r) => inr(r.taxes) }, { key: 'a', label: 'Adjustments', render: (r) => inr(r.otherCharges) }, { key: 'n', label: 'Net settlement', render: (r) => <strong>{inr(r.netPayable)}</strong> }, { key: 's', label: 'Status', render: (r) => <StatusBadge map={SETTLEMENT_STATUS} value={r.settlementStatus} /> }, { key: 'd', label: 'Settled', render: (r) => <>{dateTimeIST(r.settlementDate)}{r.reference && <span className="block text-xs text-muted">Ref {r.reference}</span>}</> },
          { key: 'x', label: '', render: (r) => <span className="flex flex-col items-start gap-1"><FileLinks path={`/transporters/me/settlements/${r.settlementId}/statement.pdf`} /><Link href={`/transporter/support/new?category=SETTLEMENT_ISSUE&subject=${encodeURIComponent(`Dispute on settlement ${r.settlementCode}`)}`}><Button size="sm" variant="secondary">Raise dispute</Button></Link></span> },
        ]} />
      )}
    </>
  );
}
