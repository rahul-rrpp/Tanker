'use client';

import { Building2, FileCheck2, History, ImagePlus, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { FileLinks } from '@/components/portal/bits';
import { ContactsCard } from '@/components/portal/ContactsCard';
import { DemoButton, DemoPanel } from '@/components/portal/DemoPanel';
import { Checkbox, ErrorBlock, LoadingBlock, Modal, PageHeader, SectionTitle, StatusBadge, TextArea, useToast } from '@/components/ui/kit';
import { Alert, Badge, Button, Card, SelectField, TextField } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';
import { dateIST, dateTimeIST } from '@/lib/format';
import { BUSINESS_TYPES, COMPANY_DOC_TYPES, COMPANY_STATUS, INDIAN_STATES } from '@/lib/status';
import { useApi } from '@/lib/useApi';

interface Address {
  address: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
}
interface CompanyDoc {
  id: string;
  type: string;
  title: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  reviewNote: string | null;
  isCurrent?: boolean;
  createdAt: string;
}
interface Profile {
  id: string;
  companyCode: string;
  name: string;
  gstNumber: string;
  panNumber: string | null;
  businessType: string;
  industry: string | null;
  website: string | null;
  contactPersonName: string;
  contactPhone: string;
  contactEmail: string;
  billingSameAsRegistered: boolean;
  status: string;
  isDemo: boolean;
  hasLogo: boolean;
  createdAt: string;
  registeredAddress: Address | null;
  billingAddress: Address | null;
  documents: CompanyDoc[];
  verification: { status: string; reason: string | null; verifiedAt: string | null; missingDocuments: string[] };
}

const emptyAddr: Address = { address: '', city: '', state: '', pincode: '', country: 'India' };
const DOC_STATUS = { UPLOADED: { label: 'Under review', tone: 'warning' as const }, VERIFIED: { label: 'Verified', tone: 'success' as const }, REJECTED: { label: 'Rejected', tone: 'danger' as const } };

function AddressFields({ value, onChange, errors, prefix }: { value: Address; onChange: (a: Address) => void; errors: Record<string, string>; prefix: string }) {
  const set = (k: keyof Address) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <TextArea label="Address" rows={2} value={value.address} onChange={set('address')} error={errors[`${prefix}.address`]} required />
      </div>
      <TextField label="City" value={value.city} onChange={set('city')} error={errors[`${prefix}.city`]} required />
      <SelectField label="State" value={value.state} onChange={set('state')} placeholder="Select state" options={INDIAN_STATES.map((s) => ({ value: s, label: s }))} error={errors[`${prefix}.state`]} required />
      <TextField label="PIN code" inputMode="numeric" maxLength={6} value={value.pincode} onChange={set('pincode')} error={errors[`${prefix}.pincode`]} required />
      <TextField label="Country" value={value.country} onChange={set('country')} error={errors[`${prefix}.country`]} />
    </div>
  );
}

export default function ProfilePage() {
  const toast = useToast();
  const { mutate: globalMutate } = useSWRConfig();
  const { data, error, mutate } = useApi<{ company: Profile }>('/companies/profile');
  const history = useApi<{ documents: CompanyDoc[] }>('/companies/documents?history=true');
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const [reg, setReg] = useState<Address>(emptyAddr);
  const [bill, setBill] = useState<Address>(emptyAddr);
  const [same, setSame] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [logoV, setLogoV] = useState(0);
  const [upload, setUpload] = useState<{ type: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [deletingDoc, setDeletingDoc] = useState<CompanyDoc | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);

  const c = data?.company;
  useEffect(() => {
    if (!c) return;
    setF({ name: c.name, panNumber: c.panNumber ?? '', businessType: c.businessType, industry: c.industry ?? '', website: c.website ?? '', contactPersonName: c.contactPersonName, contactPhone: c.contactPhone, contactEmail: c.contactEmail });
    setReg(c.registeredAddress ?? emptyAddr);
    setBill(c.billingAddress ?? c.registeredAddress ?? emptyAddr);
    setSame(c.billingSameAsRegistered);
  }, [c, editing]);

  if (error) return <ErrorBlock error={error} onRetry={() => mutate()} />;
  if (!c) return <LoadingBlock rows={8} />;

  async function save() {
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      await api.put('/companies/profile', {
        name: f.name,
        panNumber: f.panNumber || undefined,
        businessType: f.businessType,
        industry: f.industry || undefined,
        website: f.website || undefined,
        contactPersonName: f.contactPersonName,
        contactPhone: f.contactPhone,
        contactEmail: f.contactEmail,
        registeredAddress: reg,
        billingSameAsRegistered: same,
        ...(same ? {} : { billingAddress: bill }),
      });
      toast.success('Company profile saved');
      setEditing(false);
      void mutate();
    } catch (e) {
      const err = parseApiError(e);
      setFormError(err.message);
      setErrors(Object.fromEntries(err.fields.map((x) => [x.field.replace('registeredAddress', 'reg').replace('billingAddress', 'bill'), x.message])));
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      await api.post('/companies/logo', form);
      setLogoV((v) => v + 1);
      void mutate();
      toast.success('Logo updated');
    } catch (e) {
      toast.error(e);
    }
  }

  async function demoVerify() {
    setVerifying(true);
    try {
      await api.post('/demo/company/verify');
      toast.success('Company marked as verified (demo)');
      void mutate();
      // The verification banner comes from the session; reload so it disappears.
      void globalMutate(() => true);
      window.location.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setVerifying(false);
    }
  }

  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const docsByType = (t: string) => c.documents.filter((d) => d.type === t);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Company Profile"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            Company ID <strong className="font-mono text-ink">{c.companyCode}</strong> · member since {dateIST(c.createdAt)}
          </span>
        }
        actions={
          editing ? (
            <>
              <Button variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button onClick={save} loading={saving}>
                Save changes
              </Button>
            </>
          ) : (
            <Button onClick={() => setEditing(true)}>Edit profile</Button>
          )
        }
      />

      <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="relative h-16 w-16 overflow-hidden rounded-2xl border border-line bg-canvas">
            {c.hasLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/v1/companies/logo?v=${logoV}`} alt={`${c.name} logo`} className="h-full w-full object-contain" />
            ) : (
              <Building2 className="m-4 h-8 w-8 text-muted" />
            )}
          </div>
          <div>
            <p className="text-lg font-semibold text-ink">{c.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusBadge map={COMPANY_STATUS} value={c.verification.status} />
              {c.verification.verifiedAt && <span className="text-xs text-muted">since {dateIST(c.verification.verifiedAt)}</span>}
            </div>
          </div>
        </div>
        <div>
          <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => (void uploadLogo(e.target.files?.[0]), (e.target.value = ''))} />
          <Button variant="secondary" size="sm" onClick={() => logoInput.current?.click()}>
            <ImagePlus className="h-4 w-4" /> {c.hasLogo ? 'Replace logo' : 'Upload logo'}
          </Button>
        </div>
      </Card>

      {c.verification.status !== 'VERIFIED' && (
        <Alert tone={c.verification.status === 'REJECTED' ? 'error' : 'info'} title={c.verification.status === 'REJECTED' ? 'Verification rejected' : 'Verification pending'}>
          {c.verification.reason ?? (c.verification.missingDocuments.length ? `Upload: ${c.verification.missingDocuments.map((d) => COMPANY_DOC_TYPES[d]).join(', ')}.` : 'Your documents are with our verification team.')}
        </Alert>
      )}
      {c.verification.status !== 'VERIFIED' && (
        <DemoPanel title="admin verification">
          <DemoButton onClick={demoVerify} loading={verifying}>
            Simulate admin approval
          </DemoButton>
        </DemoPanel>
      )}

      {formError && <Alert>{formError}</Alert>}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <SectionTitle>Business information</SectionTitle>
          {editing ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <TextField label="Company name" value={f.name} onChange={set('name')} error={errors.name} required />
              </div>
              <TextField label="GST number" value={c.gstNumber} disabled hint="Contact support to change your GSTIN" />
              <TextField label="PAN number" value={f.panNumber} onChange={set('panNumber')} error={errors.panNumber} className="uppercase" maxLength={10} hint="Must match your GSTIN" />
              <SelectField label="Business type" value={f.businessType} onChange={set('businessType')} options={Object.entries(BUSINESS_TYPES).map(([value, label]) => ({ value, label }))} />
              <TextField label="Industry" value={f.industry} onChange={set('industry')} error={errors.industry} placeholder="e.g. Lubricants" />
              <div className="sm:col-span-2">
                <TextField label="Website" value={f.website} onChange={set('website')} error={errors.website} placeholder="www.example.com" />
              </div>
              <TextField label="Contact person" value={f.contactPersonName} onChange={set('contactPersonName')} error={errors.contactPersonName} required />
              <TextField label="Mobile" value={f.contactPhone} onChange={set('contactPhone')} error={errors.contactPhone} required />
              <div className="sm:col-span-2">
                <TextField label="Email" type="email" value={f.contactEmail} onChange={set('contactEmail')} error={errors.contactEmail} required />
              </div>
            </div>
          ) : (
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {[
                ['Company name', c.name],
                ['GST number', c.gstNumber],
                ['PAN number', c.panNumber],
                ['Business type', BUSINESS_TYPES[c.businessType]],
                ['Industry', c.industry],
                ['Website', c.website],
                ['Contact person', c.contactPersonName],
                ['Mobile', c.contactPhone],
                ['Email', c.contactEmail],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted">{k}</dt>
                  <dd className="break-words font-medium text-ink">{v || '—'}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>

        <Card>
          <SectionTitle>Registered & billing address</SectionTitle>
          {editing ? (
            <div className="space-y-5">
              <AddressFields value={reg} onChange={setReg} errors={errors} prefix="reg" />
              <Checkbox label="Billing address same as registered address" checked={same} onChange={setSame} />
              {!same && (
                <div className="border-t border-line pt-4">
                  <p className="mb-3 text-sm font-medium text-ink">Billing address</p>
                  <AddressFields value={bill} onChange={setBill} errors={errors} prefix="bill" />
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-muted">Registered address</p>
                <p className="font-medium text-ink">
                  {c.registeredAddress ? `${c.registeredAddress.address}, ${c.registeredAddress.city}, ${c.registeredAddress.state} ${c.registeredAddress.pincode}, ${c.registeredAddress.country}` : '—'}
                </p>
              </div>
              <div>
                <p className="text-muted">Billing address</p>
                <p className="font-medium text-ink">
                  {c.billingSameAsRegistered
                    ? 'Same as registered address'
                    : c.billingAddress
                      ? `${c.billingAddress.address}, ${c.billingAddress.city}, ${c.billingAddress.state} ${c.billingAddress.pincode}, ${c.billingAddress.country}`
                      : '—'}
                </p>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle
          action={
            <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
              <History className="h-4 w-4" /> Upload history
            </Button>
          }
        >
          Company documents
        </SectionTitle>
        <div className="grid gap-4 md:grid-cols-2">
          {Object.entries(COMPANY_DOC_TYPES).map(([type, label]) => {
            const docs = docsByType(type);
            const required = type === 'GST_CERTIFICATE' || type === 'PAN_CARD';
            return (
              <div key={type} className="rounded-xl border border-line p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-ink">
                    {label} {required && <span className="text-xs text-danger">required</span>}
                  </p>
                  <Button variant="secondary" size="sm" onClick={() => setUpload({ type })}>
                    <Upload className="h-4 w-4" /> {docs.length && type !== 'OTHER' ? 'Replace' : 'Upload'}
                  </Button>
                </div>
                {docs.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">Not uploaded yet</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {docs.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <FileCheck2 className="h-4 w-4 shrink-0 text-muted" />
                          <span className="truncate">{d.title ?? d.fileName}</span>
                          <StatusBadge map={DOC_STATUS} value={d.status} />
                        </span>
                        <span className="flex items-center gap-1">
                          <FileLinks href={`/api/v1/companies/documents/${d.id}/download`} />
                          {d.status !== 'VERIFIED' && (
                            <button onClick={() => setDeletingDoc(d)} className="rounded-lg p-1 text-muted hover:bg-red-50 hover:text-danger" aria-label={`Delete ${d.fileName}`} title="Delete">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </span>
                        {d.reviewNote && <p className="w-full text-xs text-danger">{d.reviewNote}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted">PDF, PNG or JPG up to 5 MB. Replacing a document keeps the earlier version in your upload history. Verified documents are locked and cannot be deleted.</p>
      </Card>

      <ContactsCard />

      <Modal
        open={Boolean(deletingDoc)}
        onClose={() => setDeletingDoc(null)}
        title="Delete document?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeletingDoc(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deletingBusy}
              onClick={async () => {
                if (!deletingDoc) return;
                setDeletingBusy(true);
                try {
                  await api.delete(`/companies/documents/${deletingDoc.id}`);
                  toast.success('Document deleted');
                  setDeletingDoc(null);
                  void mutate();
                  void history.mutate();
                } catch (e) {
                  toast.error(e);
                } finally {
                  setDeletingBusy(false);
                }
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          {deletingDoc?.fileName} will be permanently removed. You can upload it again at any time.
        </p>
      </Modal>

      <UploadDocumentDialog
        type={upload?.type ?? null}
        onClose={() => setUpload(null)}
        onDone={() => {
          void mutate();
          void history.mutate();
        }}
      />

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="Document upload history" size="lg">
        <ul className="divide-y divide-line text-sm">
          {(history.data?.documents ?? []).map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{COMPANY_DOC_TYPES[d.type]}</span> · {d.fileName} · {dateTimeIST(d.createdAt)}{' '}
                {d.isCurrent ? <Badge tone="info">Current</Badge> : <Badge>Replaced</Badge>}
              </span>
              <FileLinks href={`/api/v1/companies/documents/${d.id}/download`} />
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}

function UploadDocumentDialog({ type, onClose, onDone }: { type: string | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setFile(null);
    setTitle('');
    setError(null);
  }, [type]);
  async function submit() {
    if (!file || !type) return;
    if (file.size > 5 * 1024 * 1024) return setError('File is larger than 5 MB');
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('type', type);
    if (title) form.append('title', title);
    form.append('file', file);
    try {
      await api.post('/companies/documents', form);
      toast.success('Document uploaded');
      onDone();
      onClose();
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={Boolean(type)}
      onClose={onClose}
      title={`Upload ${type ? COMPANY_DOC_TYPES[type] : ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!file || (type === 'OTHER' && title.trim().length < 2)}>
            Upload
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {type === 'OTHER' && <TextField label="Document title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. PESO licence" />}
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-canvas/50 px-4 py-8 text-sm text-muted hover:border-brand-300">
          <Upload className="h-6 w-6" />
          {file ? <span className="font-medium text-ink">{file.name}</span> : 'Choose a PDF, PNG or JPG (max 5 MB)'}
          <input type="file" accept="application/pdf,image/png,image/jpeg" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
    </Modal>
  );
}
