'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PhoneVerification } from '@/components/auth/PhoneVerification';
import { DocumentUpload } from '@/components/transporter/ui';
import { Checkbox, ToastProvider } from '@/components/ui/kit';
import { Alert, Button, Card, PasswordField, SelectField, TextField } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';
import type { Catalog } from '@/lib/company-types';
import { INDIAN_STATES } from '@/lib/status';
import { BUSINESS_DOCS } from '@/lib/transporter';

const STEPS = ['Business', 'Operations', 'Bank', 'Verify', 'Documents'] as const;
const BUSINESS_TYPES: Record<string, string> = { FLEET_OWNER: 'Fleet owner', PROPRIETORSHIP: 'Proprietorship', PARTNERSHIP: 'Partnership', PRIVATE_LIMITED: 'Private limited', LLP: 'LLP', OTHER: 'Other' };
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

const initial = { companyName: '', ownerName: '', phone: '', email: '', password: '', confirmPassword: '', gstNumber: '', panNumber: '', businessType: 'FLEET_OWNER', address: '', city: '', state: 'Maharashtra', pincode: '', operatingCities: '', preferredRoutes: '', numberOfTankers: '', capacityCategories: '', accountHolder: '', bankName: '', accountNumber: '', ifsc: '', accountType: 'CURRENT' };

export default function TransporterRegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [f, setF] = useState(initial);
  const [states, setStates] = useState<string[]>(['Maharashtra']);
  const [products, setProducts] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [phoneToken, setPhoneToken] = useState('');
  const [emailToken, setEmailToken] = useState('');
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [next, setNext] = useState('/transporter/dashboard');

  useEffect(() => {
    api.get('/catalog').then((r) => setCatalog(r.data.data)).catch(() => undefined);
  }, []);

  const bind = (k: keyof typeof initial) => ({ value: f[k], error: fields[k], onChange: (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value })) });
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const stepValid = [
    f.companyName && f.ownerName && /^\d{10}$/.test(f.phone) && f.email.includes('@') && f.password.length >= 8 && f.password === f.confirmPassword && f.gstNumber.length === 15 && f.panNumber.length === 10 && f.address.length >= 5 && f.city && /^\d{6}$/.test(f.pincode),
    states.length > 0 && Number(f.numberOfTankers) > 0,
    f.accountHolder && f.bankName && /^\d{9,18}$/.test(f.accountNumber) && f.ifsc.length === 11,
  ];

  async function submit() {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const { data } = await api.post('/transporters/register', {
        companyName: f.companyName, ownerName: f.ownerName, phone: f.phone, email: f.email, password: f.password, confirmPassword: f.confirmPassword, gstNumber: f.gstNumber.toUpperCase(), panNumber: f.panNumber.toUpperCase(), businessType: f.businessType, address: f.address, city: f.city, state: f.state, pincode: f.pincode,
        operatingCities: list(f.operatingCities), operatingStates: states, preferredRoutes: list(f.preferredRoutes), numberOfTankers: Number(f.numberOfTankers), capacityCategories: list(f.capacityCategories), productCategories: products,
        bank: { accountHolder: f.accountHolder, bankName: f.bankName, accountNumber: f.accountNumber, ifsc: f.ifsc.toUpperCase(), accountType: f.accountType },
        acceptTerms: true, phoneVerificationToken: phoneToken, emailVerificationToken: emailToken,
      });
      setCode(data.data.transporter.transporterCode);
      setNext(data.data.redirectTo);
      setStep(4);
    } catch (e) {
      const p = parseApiError(e);
      setError(p.message);
      setFields(Object.fromEntries(p.fields.map((x) => [x.field.replace(/^bank\./, ''), x.message])));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ToastProvider>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold text-ink">Register as a transporter</h1>
        <p className="mt-1 text-sm text-muted">Already registered? <Link href="/login" className="font-semibold text-brand-600">Sign in</Link></p>
        <ol className="my-6 flex gap-2 text-xs font-medium">
          {STEPS.map((s, i) => <li key={s} className={`flex-1 rounded-lg py-2 text-center ${i === step ? 'bg-brand-600 text-white' : i < step ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-muted'}`}>{s}</li>)}
        </ol>
        <Card className="p-5 sm:p-6">
          {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
          {step === 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Transport company name" required {...bind('companyName')} />
              <TextField label="Owner / authorised person" required {...bind('ownerName')} />
              <TextField label="Mobile number" required inputMode="numeric" maxLength={10} {...bind('phone')} />
              <TextField label="Email" required type="email" {...bind('email')} />
              <PasswordField label="Password" required hint="At least 8 characters, with letters, numbers and a symbol" {...bind('password')} />
              <PasswordField label="Confirm password" required {...bind('confirmPassword')} />
              <TextField label="GST number" required maxLength={15} {...bind('gstNumber')} />
              <TextField label="PAN number" required maxLength={10} {...bind('panNumber')} />
              <SelectField label="Business type" {...bind('businessType')}>{Object.entries(BUSINESS_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</SelectField>
              <TextField label="Registered address" required {...bind('address')} />
              <TextField label="City" required {...bind('city')} />
              <SelectField label="State" {...bind('state')}>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</SelectField>
              <TextField label="Pincode" required maxLength={6} inputMode="numeric" {...bind('pincode')} />
            </div>
          )}
          {step === 1 && (
            <div className="space-y-4">
              <TextField label="Operating cities" hint="Separate with commas" {...bind('operatingCities')} />
              <div>
                <p className="mb-2 text-sm font-medium text-ink">Operating states</p>
                <div className="grid max-h-44 grid-cols-2 gap-2 overflow-y-auto rounded-xl border border-line p-3 sm:grid-cols-3">{INDIAN_STATES.map((s) => <Checkbox key={s} label={s} checked={states.includes(s)} onChange={() => toggle(states, setStates, s)} />)}</div>
              </div>
              <TextField label="Preferred routes" hint="For example: Pune-Mumbai, Nashik-Surat" {...bind('preferredRoutes')} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Number of tankers" required type="number" min={1} {...bind('numberOfTankers')} />
                <TextField label="Tanker capacity categories (KL)" hint="For example: 12, 20, 24" {...bind('capacityCategories')} />
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-ink">Product categories transported</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{catalog?.products.map((p) => <Checkbox key={p.id} label={p.name} checked={products.includes(p.code)} onChange={() => toggle(products, setProducts, p.code)} />)}</div>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Account holder name" required {...bind('accountHolder')} />
              <TextField label="Bank name" required {...bind('bankName')} />
              <TextField label="Account number" required inputMode="numeric" {...bind('accountNumber')} />
              <TextField label="IFSC code" required maxLength={11} {...bind('ifsc')} />
              <SelectField label="Account type" {...bind('accountType')}><option value="CURRENT">Current</option><option value="SAVINGS">Savings</option></SelectField>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-5">
              <PhoneVerification destination={f.phone} onVerified={setPhoneToken} verified={Boolean(phoneToken)} />
              <PhoneVerification destination={f.email} channel="EMAIL" onVerified={setEmailToken} verified={Boolean(emailToken)} />
              <Checkbox label={<>I accept the <Link href="/terms" target="_blank" className="text-brand-600 underline">Terms and Conditions</Link></>} checked={terms} onChange={setTerms} />
            </div>
          )}
          {step === 4 && (
            <div className="space-y-4">
              <Alert tone="success" title={`Registered. Your Transporter ID is ${code}.`}>Upload your documents now, or later from your profile. Our team reviews them before bidding opens.</Alert>
              <DocumentUpload endpoint="/transporters/me/documents" types={BUSINESS_DOCS} expiry onDone={() => undefined} />
              <Button fullWidth onClick={() => { router.replace(next); router.refresh(); }}>Go to my dashboard</Button>
            </div>
          )}
          {step < 3 && <div className="mt-6 flex justify-between">{step > 0 ? <Button variant="secondary" onClick={() => setStep(step - 1)}>Back</Button> : <span />}<Button disabled={!stepValid[step]} onClick={() => setStep(step + 1)}>Continue</Button></div>}
          {step === 3 && <div className="mt-6 flex justify-between"><Button variant="secondary" onClick={() => setStep(2)}>Back</Button><Button loading={busy} disabled={!phoneToken || !emailToken || !terms || busy} onClick={() => void submit()}>Create account</Button></div>}
        </Card>
      </div>
    </ToastProvider>
  );
}
