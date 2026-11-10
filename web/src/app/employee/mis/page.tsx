'use client';

import { useState } from 'react';
import { Section } from '@/components/employee/kit';
import { DataTable } from '@/components/transporter/ui';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, TextArea, useToast } from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateTimeIST, dayOnly, humanize } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type R = { id: string; date: string; reportType: string; data: Record<string, unknown>; submittedAt: string; revision: number };
type Data = { reportType: string; today: R | null; items: R[] };

const NUM: Record<string, string[]> = {
  SALES: ['callsMade', 'connectedCalls', 'interestedLeads', 'followUpsCompleted', 'physicalVisits', 'meetingsConducted', 'newCompanyLeads', 'newTransporterLeads', 'companyRegistrations', 'transporterRegistrations', 'verifiedCompanies', 'verifiedTransporters', 'firstBookingActivations', 'pendingFollowUps'],
  OPERATIONS: ['bookingsHandled', 'offersCoordinated', 'tripsMonitored', 'tripsCompleted', 'delayedTrips', 'driverAssignments', 'complaintsHandled', 'pendingTasks'],
  VERIFICATION: ['documentsReviewed', 'approved', 'rejected', 'pending', 'expiryAlerts'],
  ACCOUNTS: ['paymentsChecked', 'paymentsReconciled', 'collectionsFollowedUp', 'settlementsReviewed', 'pendingIssues'],
  GENERAL: ['tasksCompleted', 'pendingTasks'],
};
const TEXT: Record<string, string[]> = { SALES: ['challenges', 'tomorrowsPlan'], GENERAL: ['summary'] };
const label = (k: string) => humanize(k.replace(/([A-Z])/g, '_$1'));

export default function Page() {
  const toast = useToast();
  const { data, error, mutate } = useApi<Data>('/employee/mis');
  const [v, setV] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  const nums = NUM[data.reportType] ?? NUM.GENERAL;
  const texts = TEXT[data.reportType] ?? [];
  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/employee/mis', { data: { ...Object.fromEntries(nums.map((k) => [k, Number(v[k] || 0)])), ...Object.fromEntries(texts.filter((k) => v[k]?.trim()).map((k) => [k, v[k].trim()])) } });
      toast.success('Daily report submitted');
      void mutate();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title="Daily reports" subtitle={`${humanize(data.reportType)} report`} />
      {data.today ? <Alert tone="success" title="Today's report is submitted">Submitted {dateTimeIST(data.today.submittedAt)}. Corrections go through an authorised reviser.</Alert> : (
        <Section title="Today's report">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{nums.map((k) => <TextField key={k} label={label(k)} type="number" min={0} value={v[k] ?? ''} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} />)}</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{texts.map((k) => <TextArea key={k} label={label(k)} value={v[k] ?? ''} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} />)}</div>
          <Button className="mt-4" loading={busy} disabled={busy} onClick={() => void submit()}>Submit report</Button>
        </Section>
      )}
      <div className="mt-6">{data.items.length === 0 ? <EmptyState title="No reports yet" /> : <DataTable rows={data.items} rowKey={(r) => r.id} columns={[{ key: 'd', label: 'Date', render: (r) => dayOnly(r.date) }, { key: 't', label: 'Submitted', render: (r) => dateTimeIST(r.submittedAt) }, { key: 'r', label: 'Revision', render: (r) => r.revision }, { key: 'x', label: 'Summary', render: (r) => <span className="text-xs">{Object.entries(r.data).slice(0, 6).map(([k, x]) => `${label(k)}: ${String(x)}`).join(' · ')}</span> }]} />}</div>
    </>
  );
}
