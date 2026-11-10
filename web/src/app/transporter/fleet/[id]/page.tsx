'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { TripStatusBadge } from '@/components/portal/bits';
import { TankerForm, type TankerValues } from '@/components/transporter/TankerForm';
import { ActionButton, DataTable, DocumentUpload, FileLinks } from '@/components/transporter/ui';
import { ErrorBlock, KV, LoadingBlock, Modal, PageHeader, SectionTitle, StatusBadge, useToast } from '@/components/ui/kit';
import { Alert, Button, Card, SelectField } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { dateTimeIST, dayOnly, humanize, kl, timeAgo } from '@/lib/format';
import { DOC_REVIEW, TANKER_DOCS, TANKER_STATUS, VERIFICATION, type Paged } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

type Data = {
  tanker: { id: string; registrationNumber: string; capacityKl: number; compartments: number; compartmentCapacities: number[]; tankerType: { id: string; name: string }; products: { id: string; name: string }[]; assignedDriver: { id: string; name: string } | null; status: string; verificationStatus: string; rejectionReason: string | null; vehicleMake: string | null; vehicleModel: string | null; manufacturingYear: number | null; gpsDeviceId: string | null; availableLocation: string | null; availableFrom: string | null; insuranceExpiry: string | null; fitnessExpiry: string | null; permitExpiry: string | null; pucExpiry: string | null; pesoExpiry: string | null; pesoLicenceNumber: string | null; currentLocation: { lat: number; lng: number; at: string } | null };
  documents: { id: string; docType: string; fileName: string; status: string; reviewNote: string | null; expiryDate: string | null }[];
  trips: { id: string; tripCode: string; status: string; createdAt: string; booking: { bookingCode: string; product: { name: string }; locations: { type: string; city: string }[] }; driver: { user: { fullName: string } } | null }[];
};
const d = (s: string | null) => (s ? s.slice(0, 10) : '');

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const { data, error, mutate } = useApi<Data>(`/tankers/${id}`);
  const [edit, setEdit] = useState(false);
  const [assign, setAssign] = useState(false);
  const [driver, setDriver] = useState('');
  const { data: drivers } = useApi<Paged<{ id: string; fullName: string; verificationStatus: string }>>(assign ? '/transporters/me/drivers?pageSize=100' : null);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  const t = data.tanker;
  const initial: TankerValues = { registrationNumber: t.registrationNumber, vehicleMake: t.vehicleMake ?? '', vehicleModel: t.vehicleModel ?? '', manufacturingYear: String(t.manufacturingYear ?? ''), capacityKl: String(t.capacityKl), tankerTypeId: t.tankerType.id, compartments: String(t.compartments), compartmentCapacities: t.compartmentCapacities.join(', '), productIds: t.products.map((p) => p.id), gpsDeviceId: t.gpsDeviceId ?? '', availableLocation: t.availableLocation ?? '', insuranceExpiry: d(t.insuranceExpiry), fitnessExpiry: d(t.fitnessExpiry), permitExpiry: d(t.permitExpiry), pucExpiry: d(t.pucExpiry), pesoLicenceNumber: t.pesoLicenceNumber ?? '', pesoExpiry: d(t.pesoExpiry) };
  const setStatus = (status: string) => api.put(`/tankers/${id}/availability`, { status });
  return (
    <>
      <PageHeader title={t.registrationNumber} subtitle={`${t.tankerType.name} · ${kl(t.capacityKl)}`} back={{ href: '/transporter/fleet', label: 'My fleet' }} actions={<><StatusBadge map={TANKER_STATUS} value={t.status} /><StatusBadge map={VERIFICATION} value={t.verificationStatus} /><Button size="sm" variant="secondary" onClick={() => setEdit(true)}>Edit</Button></>} />
      {t.verificationStatus === 'REJECTED' && <div className="mb-4"><Alert tone="error" title="Verification rejected">{t.rejectionReason ?? 'Please update the documents.'}</Alert></div>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5"><SectionTitle>Details</SectionTitle><dl className="divide-y divide-line">
          <KV label="Make and model">{t.vehicleMake} {t.vehicleModel}</KV><KV label="Year">{t.manufacturingYear}</KV><KV label="Compartments">{t.compartments}{t.compartmentCapacities.length ? ` (${t.compartmentCapacities.join(' + ')} KL)` : ''}</KV><KV label="Permitted products">{t.products.map((p) => p.name).join(', ')}</KV><KV label="GPS device">{t.gpsDeviceId}</KV>
          <KV label="Last GPS location">{t.currentLocation ? `${t.currentLocation.lat.toFixed(4)}, ${t.currentLocation.lng.toFixed(4)} (${timeAgo(t.currentLocation.at)})` : '—'}</KV><KV label="Next available">{t.availableLocation ?? '—'}{t.availableFrom ? ` from ${dateTimeIST(t.availableFrom)}` : ''}</KV><KV label="Assigned driver">{t.assignedDriver?.name}</KV>
          <KV label="Insurance">{dayOnly(t.insuranceExpiry)}</KV><KV label="Fitness">{dayOnly(t.fitnessExpiry)}</KV><KV label="Permit">{dayOnly(t.permitExpiry)}</KV><KV label="PUC">{dayOnly(t.pucExpiry)}</KV><KV label="PESO">{t.pesoLicenceNumber ?? '—'} {t.pesoExpiry ? `(${dayOnly(t.pesoExpiry)})` : ''}</KV>
        </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setAssign(true)}>Assign driver</Button>
            <ActionButton action={() => setStatus('AVAILABLE')} success="Marked available" onDone={() => void mutate()}>Mark available</ActionButton>
            <ActionButton action={() => setStatus('MAINTENANCE')} success="Marked under maintenance" onDone={() => void mutate()}>Mark under maintenance</ActionButton>
            <ActionButton action={() => setStatus('UNAVAILABLE')} success="Marked unavailable" onDone={() => void mutate()}>Mark unavailable</ActionButton>
          </div>
        </Card>
        <Card className="p-5">
          <SectionTitle>Documents</SectionTitle>
          <DocumentUpload endpoint={`/tankers/${id}/documents`} types={TANKER_DOCS} expiry onDone={() => void mutate()} />
          <ul className="mt-3 divide-y divide-line">{data.documents.map((x) => <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span>{TANKER_DOCS[x.docType] ?? humanize(x.docType)}<span className="block text-xs text-muted">{x.fileName}{x.expiryDate ? ` · expires ${dayOnly(x.expiryDate)}` : ''}{x.reviewNote ? ` · ${x.reviewNote}` : ''}</span></span><span className="flex items-center gap-2"><StatusBadge map={DOC_REVIEW} value={x.status} /><FileLinks path={`/tankers/${id}/documents/${x.id}/download`} /></span></li>)}</ul>
        </Card>
      </div>
      <section className="mt-6">
        <SectionTitle>Booking and trip history</SectionTitle>
        {data.trips.length === 0 ? <p className="text-sm text-muted">No trips yet.</p> : <DataTable rows={data.trips} rowKey={(x) => x.id} columns={[{ key: 't', label: 'Trip', render: (x) => <Link className="font-semibold text-brand-600" href={`/transporter/trips/${x.id}`}>{x.tripCode}</Link> }, { key: 'b', label: 'Booking', render: (x) => x.booking.bookingCode }, { key: 'p', label: 'Product', render: (x) => x.booking.product.name }, { key: 'r', label: 'Route', render: (x) => x.booking.locations.map((l) => l.city).join(' → ') }, { key: 'd', label: 'Driver', render: (x) => x.driver?.user.fullName ?? '—' }, { key: 's', label: 'Status', render: (x) => <TripStatusBadge status={x.status} /> }, { key: 'c', label: 'Created', render: (x) => dateTimeIST(x.createdAt) }]} />}
      </section>
      <Modal size="lg" open={edit} onClose={() => setEdit(false)} title="Edit tanker"><TankerForm editing initial={initial} submitLabel="Save" onSubmit={async (b) => { const r = await api.put(`/tankers/${id}`, b); toast.success(r.data.message); setEdit(false); void mutate(); }} /></Modal>
      <Modal open={assign} onClose={() => setAssign(false)} title="Assign driver" footer={<><Button variant="secondary" onClick={() => setAssign(false)}>Cancel</Button><ActionButton variant="primary" size="md" disabled={!driver} success="Driver assigned" onDone={() => { setAssign(false); void mutate(); }} action={() => api.post(`/tankers/${id}/assign-driver`, { driverId: driver })}>Assign</ActionButton></>}>
        <SelectField label="Driver" value={driver} onChange={(e) => setDriver(e.target.value)}><option value="">Select…</option>{drivers?.items.filter((x) => x.verificationStatus === 'APPROVED').map((x) => <option key={x.id} value={x.id}>{x.fullName}</option>)}</SelectField>
      </Modal>
    </>
  );
}
