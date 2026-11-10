'use client';

import { useState } from 'react';
import { DocumentUpload, FileLinks } from '@/components/transporter/ui';
import { ErrorBlock, KV, LoadingBlock, Modal, PageHeader, SectionTitle, StatusBadge, useToast } from '@/components/ui/kit';
import { Alert, Button, Card, SelectField, TextField } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';
import { dayOnly, humanize } from '@/lib/format';
import { BUSINESS_DOCS, DOC_REVIEW, VERIFICATION } from '@/lib/transporter';
import { useApi } from '@/lib/useApi';

type Data = {
  transporter: { transporterCode: string; companyName: string; gstNumber: string | null; panNumber: string; businessType: string | null; address: string; operationalAddress: string | null; city: string; state: string; pincode: string; verificationStatus: string; rejectionReason: string | null; suspensionReason: string | null; serviceStates: string[]; operatingCities: string[]; preferredRoutes: string[]; productCategories: string[]; owner: { fullName: string; phone: string; email: string | null }; bank: { accountHolder: string; bankName: string; accountLast4: string; ifsc: string; accountType: string; status: string } | null };
  documents: { id: string; docType: string; fileName: string; status: string; reviewNote: string | null; expiryDate: string | null }[];
};
const csv = (a: string[]) => a.join(', ');
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export default function Page() {
  const toast = useToast();
  const { data, error, mutate } = useApi<Data>('/transporters/me');
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const [bank, setBank] = useState<Record<string, string> | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  if (error) return <ErrorBlock error={error} onRetry={() => void mutate()} />;
  if (!data) return <LoadingBlock />;
  const t = data.transporter;
  const open = () => setEdit({ ownerName: t.owner.fullName, businessType: t.businessType ?? '', address: t.address, operationalAddress: t.operationalAddress ?? '', city: t.city, state: t.state, pincode: t.pincode, operatingCities: csv(t.operatingCities), serviceStates: csv(t.serviceStates), preferredRoutes: csv(t.preferredRoutes), productCategories: csv(t.productCategories) });
  const save = async () => {
    setFail(null);
    try {
      await api.put('/transporters/me', { ...edit, operatingCities: list(edit!.operatingCities), serviceStates: list(edit!.serviceStates), preferredRoutes: list(edit!.preferredRoutes), productCategories: list(edit!.productCategories) });
      toast.success('Profile saved');
      setEdit(null);
      void mutate();
    } catch (e) {
      setFail(parseApiError(e).message);
    }
  };
  const sendCode = async () => {
    try {
      const r = await api.post('/transporters/me/bank/send-otp', {});
      setDevCode(r.data.data.devCode ?? null);
      setCodeSent(true);
      toast.success('Code sent to the registered mobile');
    } catch (e) {
      toast.error(e);
    }
  };
  const saveBank = async () => {
    setFail(null);
    try {
      const r = await api.put('/transporters/me/bank', bank);
      toast.success(r.data.message);
      setBank(null);
      setCodeSent(false);
      void mutate();
    } catch (e) {
      setFail(parseApiError(e).message);
    }
  };
  const editBind = (k: string) => ({ value: edit?.[k] ?? '', onChange: (e: { target: { value: string } }) => setEdit((v) => ({ ...v!, [k]: e.target.value })) });
  const bankBind = (k: string) => ({ value: bank?.[k] ?? '', onChange: (e: { target: { value: string } }) => setBank((v) => ({ ...v!, [k]: e.target.value })) });
  return (
    <>
      <PageHeader title="Transporter profile" subtitle={`Transporter ID ${t.transporterCode}`} actions={<><StatusBadge map={VERIFICATION} value={t.verificationStatus} /><Button size="sm" variant="secondary" onClick={open}>Edit profile</Button></>} />
      {(t.rejectionReason || t.suspensionReason) && <div className="mb-4"><Alert tone="error">{t.rejectionReason ?? t.suspensionReason}</Alert></div>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5"><SectionTitle>Business details</SectionTitle><dl className="divide-y divide-line"><KV label="Company">{t.companyName}</KV><KV label="Owner">{t.owner.fullName}</KV><KV label="GST">{t.gstNumber}</KV><KV label="PAN">{t.panNumber}</KV><KV label="Business type">{t.businessType ? humanize(t.businessType) : null}</KV><KV label="Mobile">{t.owner.phone}</KV><KV label="Email">{t.owner.email}</KV></dl><p className="mt-2 text-xs text-muted">Company name, GST and PAN change through support, because they are verified.</p></Card>
        <Card className="p-5"><SectionTitle>Address and operating areas</SectionTitle><dl className="divide-y divide-line"><KV label="Registered">{t.address}, {t.city}, {t.state} {t.pincode}</KV><KV label="Operational">{t.operationalAddress}</KV><KV label="Service cities">{csv(t.operatingCities)}</KV><KV label="Service states">{csv(t.serviceStates)}</KV><KV label="Preferred routes">{csv(t.preferredRoutes)}</KV><KV label="Product categories">{csv(t.productCategories)}</KV></dl></Card>
        <Card className="p-5">
          <SectionTitle action={<Button size="sm" variant="secondary" onClick={() => { setFail(null); setBank({ accountHolder: '', bankName: '', accountNumber: '', ifsc: '', accountType: 'CURRENT', code: '' }); }}>Change bank details</Button>}>Bank details</SectionTitle>
          {t.bank ? <dl className="divide-y divide-line"><KV label="Account holder">{t.bank.accountHolder}</KV><KV label="Bank">{t.bank.bankName}</KV><KV label="Account">••••{t.bank.accountLast4}</KV><KV label="IFSC">{t.bank.ifsc}</KV><KV label="Status">{humanize(t.bank.status)}</KV></dl> : <p className="text-sm text-muted">No bank details on file.</p>}
        </Card>
        <Card className="p-5">
          <SectionTitle>Documents</SectionTitle>
          <DocumentUpload endpoint="/transporters/me/documents" types={BUSINESS_DOCS} expiry onDone={() => void mutate()} />
          <ul className="mt-3 divide-y divide-line">{data.documents.map((d) => <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span>{BUSINESS_DOCS[d.docType] ?? humanize(d.docType)}<span className="block text-xs text-muted">{d.fileName}{d.expiryDate ? ` · expires ${dayOnly(d.expiryDate)}` : ''}{d.reviewNote ? ` · ${d.reviewNote}` : ''}</span></span><span className="flex items-center gap-2"><StatusBadge map={DOC_REVIEW} value={d.status} /><FileLinks path={`/transporters/me/documents/${d.id}/download`} /></span></li>)}</ul>
        </Card>
      </div>
      <Modal size="lg" open={Boolean(edit)} onClose={() => setEdit(null)} title="Edit profile" footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={() => void save()}>Save</Button></>}>
        {fail && <div className="mb-3"><Alert tone="error">{fail}</Alert></div>}
        <div className="grid gap-3 sm:grid-cols-2"><TextField label="Owner name" {...editBind('ownerName')} /><TextField label="Business type" {...editBind('businessType')} /><TextField label="Registered address" {...editBind('address')} /><TextField label="Operational address" {...editBind('operationalAddress')} /><TextField label="City" {...editBind('city')} /><TextField label="State" {...editBind('state')} /><TextField label="Pincode" {...editBind('pincode')} /><TextField label="Service cities" hint="Comma separated" {...editBind('operatingCities')} /><TextField label="Service states" hint="Comma separated" {...editBind('serviceStates')} /><TextField label="Preferred routes" {...editBind('preferredRoutes')} /><TextField label="Product categories" {...editBind('productCategories')} /></div>
      </Modal>
      <Modal open={Boolean(bank)} onClose={() => setBank(null)} title="Change bank details" footer={<><Button variant="secondary" onClick={() => setBank(null)}>Cancel</Button>{codeSent ? <Button disabled={!bank?.code} onClick={() => void saveBank()}>Confirm change</Button> : <Button onClick={() => void sendCode()}>Send verification code</Button>}</>}>
        <div className="space-y-3">
          <Alert tone="info">Payouts pause on the new account until TankerLink verifies it.</Alert>
          {fail && <Alert tone="error">{fail}</Alert>}
          {devCode && <Alert tone="info" title="Development OTP simulation">Code: {devCode}</Alert>}
          <TextField label="Account holder" {...bankBind('accountHolder')} /><TextField label="Bank name" {...bankBind('bankName')} /><TextField label="Account number" {...bankBind('accountNumber')} /><TextField label="IFSC" {...bankBind('ifsc')} />
          <SelectField label="Account type" {...bankBind('accountType')}><option value="CURRENT">Current</option><option value="SAVINGS">Savings</option></SelectField>
          {codeSent && <TextField label="Code from your mobile" inputMode="numeric" {...bankBind('code')} />}
        </div>
      </Modal>
    </>
  );
}
