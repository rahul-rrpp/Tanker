'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Card, PasswordField, TextField } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';

export default function Page() {
  const router = useRouter();
  const [mode, setMode] = useState<'password' | 'otp'>('password');
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const [sent, setSent] = useState<{ devCode?: string } | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setFail(null);
    try {
      await fn();
    } catch (e) {
      setFail(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  const done = (d: { data: { data: { redirectTo: string } } }) => { router.replace(d.data.data.redirectTo); router.refresh(); };
  return (
    <div className="mx-auto flex min-h-dvh max-w-md items-center px-4">
      <Card className="w-full space-y-4 p-6">
        <div><h1 className="text-xl font-bold text-ink">Employee sign in</h1><p className="text-sm text-muted">Accounts are created by your administrator.</p></div>
        {fail && <Alert tone="error">{fail}</Alert>}
        <div className="flex gap-2 text-sm"><Button size="sm" variant={mode === 'password' ? 'primary' : 'secondary'} onClick={() => { setMode('password'); setSent(null); setSecret(''); }}>Password</Button><Button size="sm" variant={mode === 'otp' ? 'primary' : 'secondary'} onClick={() => { setMode('otp'); setSecret(''); }}>OTP on mobile</Button></div>
        <TextField label={mode === 'otp' ? 'Mobile number' : 'Mobile number or email'} value={id} onChange={(e) => setId(e.target.value)} />
        {mode === 'password' && <PasswordField label="Password" value={secret} onChange={(e) => setSecret(e.target.value)} />}
        {mode === 'otp' && sent && <>{sent.devCode && <Alert tone="info" title="Development OTP simulation">Code: {sent.devCode}</Alert>}<TextField label="Code" inputMode="numeric" value={secret} onChange={(e) => setSecret(e.target.value)} /></>}
        {mode === 'password' ? <Button fullWidth loading={busy} disabled={busy || !id || !secret} onClick={() => void run(async () => done(await api.post('/employee/auth/login', { identifier: id.trim(), password: secret })))}>Sign in</Button>
          : !sent ? <Button fullWidth loading={busy} disabled={busy || !id} onClick={() => void run(async () => { const r = await api.post('/employee/auth/otp/send', { phone: id.trim() }); setSent({ devCode: r.data.data.devCode }); })}>Send code</Button>
            : <Button fullWidth loading={busy} disabled={busy || !secret} onClick={() => void run(async () => done(await api.post('/employee/auth/otp/verify', { phone: id.trim(), code: secret.trim() })))}>Verify and sign in</Button>}
        <p className="text-center text-sm"><Link className="font-semibold text-brand-600" href="/forgot-password">Forgot or never set a password?</Link></p>
      </Card>
    </div>
  );
}
