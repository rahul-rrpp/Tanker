'use client';

import { ErrorBlock, KV, LoadingBlock, StatusBadge } from '@/components/ui/kit';
import { Card } from '@/components/ui/primitives';
import { dayOnly, humanize } from '@/lib/format';
import { DOC_REVIEW, DRIVER_DOCS, VERIFICATION } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

type Me = { driver: { fullName: string; phone: string; email: string | null; transporter: string; transporterPhone: string; licenceNumber: string; licenceType: string; licenceExpiry: string; hazardousTraining: string; verificationStatus: string; emergencyContactName: string | null; emergencyContactPhone: string | null; assignedTanker: { registrationNumber: string } | null }; documents: { id: string; docType: string; status: string; expiryDate: string | null }[] };

export default function Page() {
  const { data, error, mutate } = useApi<Me>('/driver/me');
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  const d = data.driver;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-ink">My profile</h1>
      <Card className="p-4"><dl className="divide-y divide-line"><KV label="Name">{d.fullName}</KV><KV label="Mobile">{d.phone}</KV><KV label="Email">{d.email}</KV><KV label="Transporter">{d.transporter} · <a className="text-brand-600" href={`tel:${d.transporterPhone}`}>{d.transporterPhone}</a></KV><KV label="Assigned tanker">{d.assignedTanker?.registrationNumber}</KV><KV label="Licence">{d.licenceNumber} ({d.licenceType})</KV><KV label="Licence expiry">{dayOnly(d.licenceExpiry)}</KV><KV label="Hazardous training">{humanize(d.hazardousTraining)}</KV><KV label="Emergency contact">{d.emergencyContactName} {d.emergencyContactPhone}</KV><KV label="Verification"><StatusBadge map={VERIFICATION} value={d.verificationStatus} /></KV></dl></Card>
      {data.documents.length > 0 && <Card className="p-4"><ul className="divide-y divide-line">{data.documents.map((x) => <li key={x.id} className="flex items-center justify-between py-2 text-sm"><span>{DRIVER_DOCS[x.docType] ?? x.docType}</span><StatusBadge map={DOC_REVIEW} value={x.status} /></li>)}</ul></Card>}
      <p className="text-center text-xs text-muted">To change your details, contact your transporter.</p>
    </div>
  );
}
