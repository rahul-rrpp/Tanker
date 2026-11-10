'use client';

import { useState } from 'react';
import { FormModal, useCan } from '@/components/employee/kit';
import { ActionButton, DataTable, FileLinks } from '@/components/transporter/ui';
import { EmptyState, ErrorBlock, LoadingBlock, Modal, PageHeader, Tabs } from '@/components/ui/kit';
import { Badge, Button } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateTimeIST, humanize } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type Item = { id: string; category: string; kind: string; title: string; subject: string; status: string; createdAt: string; hasFile: boolean };
type H = { history: { id: string; toStatus: string; reviewer: string; reason: string | null; createdAt: string }[] };
const MOD: Record<string, string> = { COMPANY_DOC: 'documents', KYC: 'documents', BANK: 'documents', COMPANY: 'companies', TRANSPORTER: 'transporters', DRIVER: 'drivers', TANKER: 'tankers' };
const TABS = ['ALL', 'COMPANY', 'TRANSPORTER', 'DRIVER', 'TANKER'].map((value) => ({ value, label: humanize(value) }));

export default function Page() {
  const can = useCan();
  const { data, error, mutate } = useApi<{ items: Item[] }>('/employee/verifications');
  const [tab, setTab] = useState('ALL');
  const [rejecting, setRejecting] = useState<Item | null>(null);
  const [approving, setApproving] = useState<Item | null>(null);
  const [hist, setHist] = useState<Item | null>(null);
  const { data: h } = useApi<H>(hist ? `/employee/verifications/${hist.id}/history` : null);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  const rows = data.items.filter((i) => tab === 'ALL' || i.category === tab);
  const m = (i: Item) => MOD[i.id.split(':')[0]];
  return (
    <>
      <PageHeader title="Fleet & document verification" subtitle="Oldest items first" />
      <div className="mb-4"><Tabs tabs={TABS} value={tab} onChange={setTab} /></div>
      {rows.length === 0 ? <EmptyState title="Queue is clear" /> : <DataTable rows={rows} rowKey={(i) => i.id} columns={[{ key: 'c', label: 'Category', render: (i) => humanize(i.category) }, { key: 't', label: 'Item', render: (i) => (i.kind === 'DOCUMENT' ? humanize(i.title) : i.title) }, { key: 's', label: 'For', render: (i) => i.subject }, { key: 'st', label: 'Status', render: (i) => <Badge tone="warning">{humanize(i.status)}</Badge> }, { key: 'd', label: 'Received', render: (i) => dateTimeIST(i.createdAt) }, { key: 'a', label: '', render: (i) => <span className="flex flex-wrap items-center gap-1">{i.hasFile && <FileLinks path={`/employee/verifications/${i.id}/file`} />}{can(`${m(i)}.approve`) && (i.kind === 'DOCUMENT' ? <Button size="sm" onClick={() => setApproving(i)}>Approve</Button> : <ActionButton variant="primary" action={() => api.post(`/employee/verifications/${i.id}/approve`, {})} success="Approved" onDone={() => void mutate()} confirm={`Approve ${i.subject}?`}>Approve</ActionButton>)}{can(`${m(i)}.reject`) && <Button size="sm" variant="danger" onClick={() => setRejecting(i)}>Reject</Button>}<Button size="sm" variant="secondary" onClick={() => setHist(i)}>History</Button></span> }]} />}
      <FormModal open={Boolean(approving)} onClose={() => setApproving(null)} title="Approve document" submit="Approve" fields={[{ name: 'expiryDate', label: 'Expiry date (if any)', type: 'date' }]} onSubmit={async (v) => { await api.post(`/employee/verifications/${approving!.id}/approve`, v.expiryDate ? v : {}); void mutate(); }} />
      <FormModal open={Boolean(rejecting)} onClose={() => setRejecting(null)} title="Reject" submit="Submit" fields={[{ name: 'reason', label: 'Reason', type: 'textarea', required: true }, { name: 'action', label: 'Action', type: 'select', options: [{ value: 'REJECT', label: 'Reject' }, { value: 'REUPLOAD', label: 'Request re-upload' }], initial: 'REJECT', required: true }]} onSubmit={async (v) => { await api.post(`/employee/verifications/${rejecting!.id}/reject`, { reason: v.reason, reupload: v.action === 'REUPLOAD' }); void mutate(); }} />
      <Modal open={Boolean(hist)} onClose={() => setHist(null)} title="Verification history">{!h ? <LoadingBlock rows={2} /> : h.history.length === 0 ? <p className="text-sm text-muted">No reviews yet.</p> : <ul className="space-y-2 text-sm">{h.history.map((x) => <li key={x.id}>{humanize(x.toStatus)} by {x.reviewer} · {dateTimeIST(x.createdAt)}{x.reason ? ` · ${x.reason}` : ''}</li>)}</ul>}</Modal>
    </>
  );
}
