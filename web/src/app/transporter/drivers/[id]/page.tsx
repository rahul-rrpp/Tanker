'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { TripStatusBadge } from '@/components/portal/bits';
import { DriverForm, type DriverValues } from '@/components/transporter/DriverForm';
import { ActionButton, DataTable, DocumentUpload, FileLinks } from '@/components/transporter/ui';
import { ErrorBlock, KV, LoadingBlock, Modal, PageHeader, SectionTitle, StatusBadge, useToast } from '@/components/ui/kit';
import { Alert, Button, Card } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateTimeIST, dayOnly, humanize, timeAgo } from '@/lib/format';
import { ACCOUNT_STATUS, DOC_REVIEW, DRIVER_DOCS, VERIFICATION } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

type Data = {
  driver: { id: string; fullName: string; phone: string; email: string | null; accountStatus: string; isActive: boolean; isPhoneVerified: boolean; lastLoginAt: string | null; invitedAt: string | null; licenceNumber: string; licenceType: string; licenceExpiry: string; hazardousTraining: string; hazardousTrainingExpiry: string | null; address: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null; employmentStatus: string; verificationStatus: string; rejectionReason: string | null; assignedTanker: { registrationNumber: string } | null };
  documents: { id: string; docType: string; fileName: string; status: string; reviewNote: string | null; expiryDate: string | null }[];
  trips: { id: string; tripCode: string; status: string; createdAt: string; tanker: { registrationNumber: string } | null; booking: { bookingCode: string; locations: { type: string; city: string }[] } }[];
  performance: { assigned: number; completed: number; cancelled: number; onTimePercent: number | null };
};

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const { data, error, mutate } = useApi<Data>(`/transporters/me/drivers/${id}`);
  const [edit, setEdit] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  const d = data.driver;
  const initial: DriverValues = { fullName: d.fullName, phone: d.phone, email: d.email ?? '', address: d.address ?? '', licenceNumber: d.licenceNumber, licenceType: d.licenceType, licenceExpiry: d.licenceExpiry.slice(0, 10), hazardousTraining: d.hazardousTraining, hazardousTrainingExpiry: d.hazardousTrainingExpiry?.slice(0, 10) ?? '', emergencyContactName: d.emergencyContactName ?? '', emergencyContactPhone: d.emergencyContactPhone ?? '', employmentStatus: d.employmentStatus };
  const status = (action: string) => api.put(`/transporters/me/drivers/${id}/status`, { action });
  return (
    <>
      <PageHeader title={d.fullName} subtitle={`${d.phone} · ${d.licenceNumber}`} back={{ href: '/transporter/drivers', label: 'Drivers' }} actions={<><StatusBadge map={VERIFICATION} value={d.verificationStatus} /><StatusBadge map={ACCOUNT_STATUS} value={d.accountStatus} /><Button size="sm" variant="secondary" onClick={() => setEdit(true)}>Edit</Button></>} />
      {d.verificationStatus === 'REJECTED' && <div className="mb-4"><Alert tone="error" title="Verification rejected">{d.rejectionReason ?? 'Please update the documents.'}</Alert></div>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5"><SectionTitle>Details</SectionTitle><dl className="divide-y divide-line"><KV label="Address">{d.address}</KV><KV label="Email">{d.email}</KV><KV label="Licence type">{d.licenceType}</KV><KV label="Licence expiry">{dayOnly(d.licenceExpiry)}</KV><KV label="Hazardous training">{humanize(d.hazardousTraining)}{d.hazardousTrainingExpiry ? ` until ${dayOnly(d.hazardousTrainingExpiry)}` : ''}</KV><KV label="Emergency contact">{d.emergencyContactName} {d.emergencyContactPhone}</KV><KV label="Employment">{humanize(d.employmentStatus)}</KV><KV label="Assigned tanker">{d.assignedTanker?.registrationNumber}</KV><KV label="Last sign-in">{timeAgo(d.lastLoginAt)}</KV><KV label="Last invited">{dateTimeIST(d.invitedAt)}</KV></dl></Card>
        <div className="space-y-5">
          <Card className="p-5">
            <SectionTitle>Login access</SectionTitle>
            <p className="mb-3 text-sm text-muted">The driver signs in at /login with a one-time code sent to {d.phone}.</p>
            {devCode && <div className="mb-3"><Alert tone="info" title="Development OTP simulation">Code: {devCode}</Alert></div>}
            <div className="flex flex-wrap gap-2">
              <ActionButton variant="primary" action={async () => { const r = await api.post(`/transporters/me/drivers/${id}/invite`, {}); setDevCode(r.data.data.devCode ?? null); }} success="Login code sent" onDone={() => void mutate()}>Send login invitation</ActionButton>
              {(d.accountStatus === 'SUSPENDED' || !d.isActive) && <ActionButton action={() => status('ACTIVATE')} success="Driver activated" onDone={() => void mutate()}>Activate</ActionButton>}
              {d.accountStatus !== 'SUSPENDED' && d.isActive && <ActionButton variant="danger" action={() => status('SUSPEND')} success="Driver suspended" onDone={() => void mutate()} confirm="Suspend this driver and end their sessions now?">Suspend</ActionButton>}
              {d.isActive && <ActionButton variant="danger" action={() => status('DEACTIVATE')} success="Driver deactivated" onDone={() => void mutate()} confirm="Deactivate this driver?">Deactivate</ActionButton>}
              <ActionButton action={() => status('RESET_ACCESS')} success="Access reset" onDone={() => { toast.info('All of this driver’s devices have been signed out.'); void mutate(); }} confirm="Sign this driver out everywhere and clear any password?">Reset access</ActionButton>
            </div>
          </Card>
          <Card className="p-5">
            <SectionTitle>Performance</SectionTitle>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[['Assigned', data.performance.assigned], ['Completed', data.performance.completed], ['Cancelled', data.performance.cancelled], ['On time', data.performance.onTimePercent === null ? '—' : `${data.performance.onTimePercent}%`]].map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="text-xl font-bold tabular-nums">{v}</dd></div>)}</dl>
          </Card>
        </div>
      </div>
      <Card className="mt-5 p-5">
        <SectionTitle>Documents</SectionTitle>
        <DocumentUpload endpoint={`/transporters/me/drivers/${id}/documents`} types={DRIVER_DOCS} expiry onDone={() => void mutate()} />
        <ul className="mt-3 divide-y divide-line">{data.documents.map((x) => <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span>{DRIVER_DOCS[x.docType] ?? humanize(x.docType)}<span className="block text-xs text-muted">{x.fileName}{x.reviewNote ? ` · ${x.reviewNote}` : ''}</span></span><span className="flex items-center gap-2"><StatusBadge map={DOC_REVIEW} value={x.status} /><FileLinks path={`/transporters/me/drivers/${id}/documents/${x.id}/download`} /></span></li>)}</ul>
      </Card>
      <section className="mt-6"><SectionTitle>Trip history</SectionTitle>{data.trips.length === 0 ? <p className="text-sm text-muted">No trips yet.</p> : <DataTable rows={data.trips} rowKey={(t) => t.id} columns={[{ key: 'a', label: 'Trip', render: (t) => <Link className="font-semibold text-brand-600" href={`/transporter/trips/${t.id}`}>{t.tripCode}</Link> }, { key: 'b', label: 'Booking', render: (t) => t.booking.bookingCode }, { key: 'r', label: 'Route', render: (t) => t.booking.locations.map((l) => l.city).join(' → ') }, { key: 't', label: 'Tanker', render: (t) => t.tanker?.registrationNumber ?? '—' }, { key: 's', label: 'Status', render: (t) => <TripStatusBadge status={t.status} /> }, { key: 'c', label: 'Created', render: (t) => dateTimeIST(t.createdAt) }]} />}</section>
      <Modal size="lg" open={edit} onClose={() => setEdit(false)} title="Edit driver"><DriverForm editing initial={initial} submitLabel="Save" onSubmit={async (b) => { const r = await api.put(`/transporters/me/drivers/${id}`, b); toast.success(r.data.message); setEdit(false); void mutate(); }} /></Modal>
    </>
  );
}
