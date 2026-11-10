'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, Button, Card, Input } from '@/components/ui';
import { api, parseApiError } from '@/lib/api';

type Challenge = { challengeToken: string; channel: 'EMAIL' | 'SMS'; destination: string; devCode?: string };

const NOTICES: Record<string, string> = {
  expired: 'Your session expired. Please sign in again.',
  logout: 'You have been signed out.',
  forbidden: 'That account does not have admin access.',
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next');
  const notice = NOTICES[params.get('reason') ?? ''];
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setFail(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setFail(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  const signIn = () => run(async () => {
    const { data } = await api.post<{ data: Challenge }>('/admin/auth/login', { identifier: identifier.trim(), password });
    setChallenge(data.data);
    setCode('');
  });
  const verify = () => run(async () => {
    await api.post('/admin/auth/verify-2fa', { challengeToken: challenge!.challengeToken, code: code.trim() });
    router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
  });
  const resend = () => run(async () => {
    const { data } = await api.post<{ data: { devCode?: string } }>('/admin/auth/resend-2fa', { challengeToken: challenge!.challengeToken });
    setChallenge((c) => (c ? { ...c, devCode: data.data.devCode } : c));
    setInfo('A new code has been sent.');
  });

  return (
    <Card className="w-full space-y-4 p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 font-bold text-white">TL</span>
        <div><h1 className="text-xl font-bold text-ink">TankerLink Admin</h1><p className="text-sm text-muted">{challenge ? `Enter the code sent to ${challenge.destination}` : 'Sign in with your administrator account'}</p></div>
      </div>
      {notice && !fail && <Alert tone="info">{notice}</Alert>}
      {fail && <Alert tone="error">{fail}</Alert>}
      {info && <Alert tone="success">{info}</Alert>}
      {!challenge ? (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void signIn(); }}>
          <Input label="Mobile number or email" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required autoFocus />
          <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Button type="submit" className="w-full" loading={busy} disabled={!identifier || !password}>Continue</Button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          {challenge.devCode && <Alert tone="info" title="Development code">{challenge.devCode}</Alert>}
          <Input label="Verification code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
          <Button type="submit" className="w-full" loading={busy} disabled={code.trim().length < 4}>Verify and sign in</Button>
          <div className="flex justify-between text-sm">
            <button type="button" className="font-semibold text-brand-600" onClick={() => { setChallenge(null); setPassword(''); }}>Back</button>
            <button type="button" className="font-semibold text-brand-600" disabled={busy} onClick={() => void resend()}>Resend code</button>
          </div>
        </form>
      )}
      <p className="text-center text-xs text-muted">Forgot your password? Reset it from the main TankerLink site, or ask another administrator.</p>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md items-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
