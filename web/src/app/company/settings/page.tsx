'use client';

import { Bell, Building2, KeyRound, LogOut, Mail, MapPin, Monitor, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DevOtpHint } from '@/components/auth/DevOtpHint';
import { ErrorBlock, LoadingBlock, Modal, PageHeader, SectionTitle, Toggle, useToast } from '@/components/ui/kit';
import { OtpInput } from '@/components/ui/OtpInput';
import { Alert, Badge, Button, Card, PasswordField, TextField } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';
import { dateTimeIST } from '@/lib/format';
import type { AuthUser } from '@/lib/types';
import { useApi } from '@/lib/useApi';

type Channel = 'inApp' | 'sms' | 'whatsapp' | 'email';
type Prefs = Record<string, Record<Channel, boolean>>;
const CATEGORY_LABEL: Record<string, string> = { account: 'Account & verification', bookings: 'Bookings', offers: 'Offers & negotiation', trips: 'Trips & delivery', payments: 'Payments', support: 'Support' };

function ChangePassword() {
  const toast = useToast();
  const [f, setF] = useState({ currentPassword: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      const { data } = await api.post('/auth/change-password', f);
      toast.success(`Password updated. ${data.data.otherSessionsRevoked} other session(s) signed out.`);
      setF({ currentPassword: '', password: '', confirmPassword: '' });
    } catch (e) {
      const err = parseApiError(e);
      setErrors({ ...Object.fromEntries(err.fields.map((x) => [x.field, x.message])), ...(err.fields.length ? {} : { currentPassword: err.message }) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <SectionTitle>
        <span className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> Change password
        </span>
      </SectionTitle>
      <div className="grid gap-4 sm:grid-cols-3">
        <PasswordField label="Current password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} error={errors.currentPassword} />
        <PasswordField label="New password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} error={errors.password} hint="8+ chars, upper & lower case, a number" />
        <PasswordField label="Confirm new password" autoComplete="new-password" value={f.confirmPassword} onChange={(e) => setF({ ...f, confirmPassword: e.target.value })} error={errors.confirmPassword} />
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={submit} loading={busy} disabled={!f.password}>
          Update password
        </Button>
      </div>
    </Card>
  );
}

function ContactChange({ kind, current, onChanged }: { kind: 'phone' | 'email'; current: string | null; onChanged: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [sent, setSent] = useState<{ devCode?: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = kind === 'phone' ? 'mobile number' : 'email';

  function reset() {
    setValue('');
    setSent(null);
    setCode('');
    setError(null);
  }
  async function send() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post('/auth/contact/send-otp', { [kind]: value.trim() });
      setSent({ devCode: data.data.devCode });
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/contact/verify', { [kind]: value.trim(), code });
      toast.success(`Your ${label} has been updated`);
      setOpen(false);
      reset();
      onChanged();
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex items-center gap-3">
        {kind === 'phone' ? <Smartphone className="h-5 w-5 text-muted" /> : <Mail className="h-5 w-5 text-muted" />}
        <div>
          <p className="text-sm font-medium text-ink">{kind === 'phone' ? 'Mobile number' : 'Email'}</p>
          <p className="text-sm text-muted">{current ?? 'Not set'}</p>
        </div>
      </div>
      <Button variant="secondary" size="sm" onClick={() => (reset(), setOpen(true))}>
        Change
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Change ${label}`}
        footer={
          sent ? (
            <Button onClick={verify} loading={busy} disabled={code.length !== 6}>
              Verify &amp; update
            </Button>
          ) : (
            <Button onClick={send} loading={busy} disabled={value.trim().length < 5}>
              Send verification code
            </Button>
          )
        }
      >
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <TextField label={`New ${label}`} type={kind === 'email' ? 'email' : 'tel'} prefix={kind === 'phone' ? '+91' : undefined} value={value} onChange={(e) => setValue(e.target.value)} disabled={Boolean(sent)} />
          {sent && (
            <>
              <p className="text-sm text-muted">Enter the 6-digit code sent to your new {label}.</p>
              <DevOtpHint code={sent.devCode} />
              <OtpInput value={code} onChange={setCode} autoFocus />
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}

function NotificationPrefs() {
  const toast = useToast();
  const { data, error, mutate } = useApi<{ preferences: Prefs; channels: Record<Channel, string> }>('/notifications/preferences');
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setPrefs(data.preferences);
  }, [data]);
  if (error) return <ErrorBlock error={error} />;
  if (!prefs || !data) return <LoadingBlock rows={3} />;
  async function save() {
    setBusy(true);
    try {
      await api.put('/notifications/preferences', { preferences: prefs });
      toast.success('Notification preferences saved');
      void mutate();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  const channels: { key: Channel; label: string }[] = [
    { key: 'inApp', label: 'In-app' },
    { key: 'sms', label: 'SMS' },
    { key: 'whatsapp', label: 'WhatsApp' },
    { key: 'email', label: 'Email' },
  ];
  return (
    <Card>
      <SectionTitle>
        <span className="flex items-center gap-2">
          <Bell className="h-4 w-4" /> Notification preferences
        </span>
      </SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-2 font-medium">Category</th>
              {channels.map((c) => (
                <th key={c.key} className="py-2 text-center font-medium">
                  {c.label}
                  {data.channels[c.key] !== 'active' && <span className="block text-[10px] font-normal normal-case">{data.channels[c.key]}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(prefs).map(([cat, p]) => (
              <tr key={cat} className="border-t border-line">
                <td className="py-3 font-medium text-ink">{CATEGORY_LABEL[cat] ?? cat}</td>
                {channels.map((c) => (
                  <td key={c.key} className="py-3 text-center">
                    <Toggle
                      label={`${CATEGORY_LABEL[cat]} via ${c.label}`}
                      checked={p[c.key]}
                      disabled={cat === 'account' && c.key === 'inApp'}
                      onChange={(v) => setPrefs({ ...prefs, [cat]: { ...p, [c.key]: v } })}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">SMS, WhatsApp and email delivery are wired up and will start sending once a provider is connected. Your choices are saved now.</p>
      <div className="mt-4 flex justify-end">
        <Button onClick={save} loading={busy}>
          Save preferences
        </Button>
      </div>
    </Card>
  );
}

interface Session {
  id: string;
  clientType: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  current: boolean;
}

export default function SettingsPage() {
  const toast = useToast();
  const me = useApi<{ user: AuthUser }>('/auth/me');
  const sessions = useApi<{ sessions: Session[] }>('/auth/sessions');
  const history = useApi<{ history: { id: string; event: string; method: string | null; success: boolean; failureReason: string | null; ipAddress: string | null; userAgent: string | null; createdAt: string }[] }>('/auth/login-history');
  const [loggingOut, setLoggingOut] = useState<'one' | 'all' | null>(null);

  async function revoke(id: string) {
    try {
      await api.delete(`/auth/sessions/${id}`);
      toast.success('Session signed out');
      void sessions.mutate();
    } catch (e) {
      toast.error(e);
    }
  }
  async function logout(all: boolean) {
    setLoggingOut(all ? 'all' : 'one');
    try {
      await api.post(all ? '/auth/logout-all' : '/auth/logout', {});
    } finally {
      window.location.assign('/login?reason=logout');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Account security, contact details and notifications." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/company/profile" className="flex items-center gap-3 rounded-2xl border border-line bg-white p-4 hover:border-brand-300">
          <Building2 className="h-5 w-5 text-brand-600" />
          <span>
            <span className="block font-semibold text-ink">Edit company profile</span>
            <span className="text-sm text-muted">Business details, addresses and documents</span>
          </span>
        </Link>
        <Link href="/company/locations" className="flex items-center gap-3 rounded-2xl border border-line bg-white p-4 hover:border-brand-300">
          <MapPin className="h-5 w-5 text-brand-600" />
          <span>
            <span className="block font-semibold text-ink">Manage saved addresses</span>
            <span className="text-sm text-muted">Factories, depots and delivery points</span>
          </span>
        </Link>
      </div>

      <Card>
        <SectionTitle>Login contact details</SectionTitle>
        {me.data ? (
          <div className="divide-y divide-line">
            <ContactChange kind="phone" current={me.data.user.phone} onChanged={() => me.mutate()} />
            <ContactChange kind="email" current={me.data.user.email} onChanged={() => me.mutate()} />
          </div>
        ) : (
          <LoadingBlock rows={2} />
        )}
      </Card>

      <ChangePassword />
      <NotificationPrefs />

      <Card>
        <SectionTitle>
          <span className="flex items-center gap-2">
            <Monitor className="h-4 w-4" /> Active sessions
          </span>
        </SectionTitle>
        <ul className="divide-y divide-line text-sm">
          {(sessions.data?.sessions ?? []).map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <p className="font-medium text-ink">
                  {s.deviceInfo ?? s.clientType} {s.current && <Badge tone="success">This device</Badge>}
                </p>
                <p className="text-xs text-muted">
                  Signed in {dateTimeIST(s.createdAt)} · IP {s.ipAddress ?? '—'}
                </p>
              </div>
              {!s.current && (
                <Button variant="ghost" size="sm" onClick={() => revoke(s.id)}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="!p-0">
        <div className="p-5 pb-0 sm:p-6 sm:pb-0">
          <SectionTitle>Login history</SectionTitle>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-6 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Method</th>
                <th className="px-3 py-2 font-medium">IP address</th>
                <th className="px-6 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {(history.data?.history ?? []).map((h) => (
                <tr key={h.id} className="border-b border-line last:border-0">
                  <td className="px-6 py-2.5 text-muted">{dateTimeIST(h.createdAt)}</td>
                  <td className="px-3 py-2.5">{h.event.replace(/_/g, ' ').toLowerCase()}</td>
                  <td className="px-3 py-2.5">{h.method ?? '—'}</td>
                  <td className="px-3 py-2.5">{h.ipAddress ?? '—'}</td>
                  <td className="px-6 py-2.5">{h.success ? <Badge tone="success">Success</Badge> : <Badge tone="danger">{h.failureReason?.replace(/_/g, ' ').toLowerCase() ?? 'Failed'}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">Sign out</p>
          <p className="text-sm text-muted">Sign out of this device, or of every device at once.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => logout(true)} loading={loggingOut === 'all'}>
            Sign out everywhere
          </Button>
          <Button variant="danger" onClick={() => logout(false)} loading={loggingOut === 'one'}>
            <LogOut className="h-4 w-4" /> Logout
          </Button>
        </div>
      </Card>
    </div>
  );
}
