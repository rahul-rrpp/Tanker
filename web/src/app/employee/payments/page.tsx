'use client';

import { IndianRupee } from 'lucide-react';
import { useState } from 'react';
import { FormModal, ListPage, opts, useCan } from '@/components/employee/kit';
import { PaymentStatusBadge } from '@/components/portal/bits';
import { ErrorBlock, LoadingBlock, StatCard } from '@/components/ui/kit';
import { Button } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { humanize, inr } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type P = { id: string; bookingCode: string; company: string; invoiced: number; paid: number; outstanding: number; paymentStatus: string };
const MONEY = ['totalCollectionDue', 'collectionReceived', 'pendingCollection', 'pendingSettlements'];

export default function Page() {
  const can = useCan();
  const { data, error, mutate } = useApi<Record<string, number>>('/employee/payments/summary');
  const [row, setRow] = useState<P | null>(null);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">{['totalCollectionDue', 'collectionReceived', 'pendingCollection', 'failedPayments', 'refundRequests', 'pendingSettlements'].map((k) => <StatCard key={k} label={humanize(k.replace(/([A-Z])/g, '_$1'))} value={MONEY.includes(k) ? inr(data[k]) : data[k]} icon={<IndianRupee className="h-5 w-5" />} />)}</div>
      <ListPage<P> title="Payment follow-ups" subtitle="Read-only financial records. Follow-ups and notes are logged separately." path="/employee/payments" exportable={can('payments.export')} rowKey={(p) => p.id} columns={[{ key: 'b', label: 'Booking', render: (p) => p.bookingCode }, { key: 'c', label: 'Company', render: (p) => p.company }, { key: 'i', label: 'Invoiced', render: (p) => inr(p.invoiced) }, { key: 'pa', label: 'Paid', render: (p) => inr(p.paid) }, { key: 'o', label: 'Outstanding', render: (p) => <strong>{inr(p.outstanding)}</strong> }, { key: 's', label: 'Status', render: (p) => <PaymentStatusBadge status={p.paymentStatus} /> }, { key: 'a', label: '', render: (p) => (can('payments.edit') ? <Button size="sm" variant="secondary" onClick={() => setRow(p)}>Record</Button> : null) }]} />
      <FormModal open={Boolean(row)} onClose={() => setRow(null)} title={row ? `Record for ${row.bookingCode}` : ''} submit="Save" fields={[{ name: 'kind', label: 'Type', type: 'select', options: opts({ FOLLOW_UP: 'Follow-up', RECONCILIATION: 'Reconciliation note', ESCALATION: 'Escalate dispute' }), initial: 'FOLLOW_UP', required: true }, { name: 'note', label: 'Note', type: 'textarea', required: true }]} onSubmit={async (v) => { await api.post(`/employee/payments/${row!.id}/notes`, v); }} />
    </>
  );
}
