'use client';

import { useState } from 'react';
import { DataTable, FileLinks } from '@/components/transporter/ui';
import { DemoBadge, EmptyState, ErrorBlock, LoadingBlock, PageHeader } from '@/components/ui/kit';
import { Card, SelectField, TextField } from '@/components/ui/primitives';
import { dateIST } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type Doc = { key: string; type: string; typeLabel: string; title: string; bookingCode: string; date: string; isDemo: boolean; href: string };
const TYPES: Record<string, string> = { BOOKING_CONFIRMATION: 'Booking confirmation', FREIGHT_INVOICE: 'Freight invoice', PAYMENT_RECEIPT: 'Payment receipt', SETTLEMENT_STATEMENT: 'Settlement statement', LOADING_SLIP: 'Loading documents', DELIVERY_PROOF: 'Delivery proof', LORRY_RECEIPT: 'Transport documents', E_WAY_BILL: 'E-way bill' };

export default function Page() {
  const [f, setF] = useState({ type: '', bookingCode: '', from: '', to: '' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const { data, error, mutate } = useApi<{ items: Doc[] }>(`/transporters/me/documents-centre?${qs}`);
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value })) });
  return (
    <>
      <PageHeader title="Invoices & documents" subtitle="Every file is checked against your account when opened" />
      <Card className="mb-4 grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
        <SelectField label="Type" {...bind('type')}><option value="">All</option>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</SelectField>
        <TextField label="Booking" placeholder="TLB…" {...bind('bookingCode')} /><TextField label="From" type="date" {...bind('from')} /><TextField label="To" type="date" {...bind('to')} />
      </Card>
      {error ? <ErrorBlock error={error} onRetry={() => void mutate()} /> : !data ? <LoadingBlock /> : data.items.length === 0 ? <EmptyState title="No documents found" /> : (
        <DataTable rows={data.items} rowKey={(d) => d.key} columns={[{ key: 'n', label: 'Document', render: (d) => <>{d.title} {d.isDemo && <DemoBadge />}</> }, { key: 't', label: 'Type', render: (d) => d.typeLabel }, { key: 'b', label: 'Booking', render: (d) => d.bookingCode }, { key: 'd', label: 'Date', render: (d) => dateIST(d.date) }, { key: 'a', label: '', render: (d) => <FileLinks path={d.href} /> }]} />
      )}
    </>
  );
}
