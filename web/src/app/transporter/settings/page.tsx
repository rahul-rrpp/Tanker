'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ActionButton, DataTable } from '@/components/transporter/ui';
import { Checkbox, ErrorBlock, LoadingBlock, PageHeader, SectionTitle, Toggle, useToast } from '@/components/ui/kit';
import { Alert, Button, Card, PasswordField, TextField } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';
import { dateTimeIST, humanize } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type Prefs = Record<string, { inApp: boolean; sms: boolean; whatsapp: boolean; email: boolean }>;
type Login = { id: string; event: string; method: string | null; success: boolean; ipAddress: string | null; createdAt: string };
type Me = { transporter: { bookingAlertPrefs: { newBookings: boolean; expiring: boolean; minFreight: number | null } | null; owner: { phone: string; email: string | null } } };

function Password() {
  const toast = useToast();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [fail, setFail] = useState<string | null>(null);
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value })) });
  const go = async () => {
    setFail(null);
    try {
      await api.post('/auth/change-password', f);
      toast.success('Password changed');
      setF({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (e) {
      setFail(parseApiError(e).message);
    }
  };
  return <Card className="space-y-3 p-5"><SectionTitle>Change password</SectionTitle>{fail && <Alert tone="error">{fail}</Alert>}<PasswordField label="Current password" {...bind('currentPassword')} /><PasswordField label="New password" {...bind('newPassword')} /><PasswordField label="Confirm new password" {...bind('confirmPassword')} /><Button size="sm" disabled={!f.currentPassword || !f.newPassword} onClick={() => void go()}>Change password</Button></Card>;
}

function Contact({ kind, current }: { kind: 'phone' | 'email'; current: string | null }) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [dev, setDev] = useState<string | null>(null);
  const label = kind === 'phone' ? 'mobile' : 'email';
  const send = async () => {
    try {
      const r = await api.post('/auth/contact/send-otp', { [kind]: value.trim() });
      setSent(true);
      setDev(r.data.data?.devCode ?? null);
    } catch (e) {
      toast.error(e);
    }
  };
  const confirm = async () => {
    try {
      await api.post('/auth/contact/verify', { [kind]: value.trim(), code: code.trim() });
      toast.success(`${kind === 'phone' ? 'Mobile' : 'Email'} updated`);
      window.location.reload();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="space-y-2">
      <TextField label={`Change ${label}`} hint={`Current: ${current ?? 'none'}`} value={value} onChange={(e) => setValue(e.target.value)} />
      {dev && <Alert tone="info" title="Development OTP simulation">Code: {dev}</Alert>}
      {sent && <TextField label="Verification code" value={code} onChange={(e) => setCode(e.target.value)} />}
      {sent ? <Button size="sm" onClick={() => void confirm()}>Confirm</Button> : <Button size="sm" variant="secondary" disabled={!value.trim()} onClick={() => void send()}>Send code</Button>}
    </div>
  );
}

export default function Page() {
  const toast = useToast();
  const { data: me, error } = useApi<Me>('/transporters/me');
  const { data: pref, mutate } = useApi<{ preferences: Prefs }>('/notifications/preferences');
  const { data: hist } = useApi<{ history?: Login[]; items?: Login[] }>('/auth/login-history');
  const [alerts, setAlerts] = useState({ newBookings: true, expiring: true, minFreight: '' });
  useEffect(() => {
    const p = me?.transporter.bookingAlertPrefs;
    if (p) setAlerts({ newBookings: p.newBookings, expiring: p.expiring, minFreight: p.minFreight === null ? '' : String(p.minFreight) });
  }, [me]);
  if (error) return <ErrorBlock error={error} />;
  if (!me || !pref) return <LoadingBlock rows={6} />;
  const setCh = async (cat: string, ch: string, v: boolean) => {
    try {
      const preferences = { ...pref.preferences, [cat]: { ...pref.preferences[cat], [ch]: v } };
      await api.put('/notifications/preferences', { preferences });
      void mutate();
    } catch (e) {
      toast.error(e);
    }
  };
  const logins = hist?.history ?? hist?.items ?? [];
  return (
    <>
      <PageHeader title="Settings" actions={<Link href="/transporter/profile"><Button size="sm" variant="secondary">Edit profile, routes and products</Button></Link>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Password />
        <Card className="space-y-5 p-5"><SectionTitle>Contact details</SectionTitle><Contact kind="phone" current={me.transporter.owner.phone} /><Contact kind="email" current={me.transporter.owner.email} /></Card>
        <Card className="p-5">
          <SectionTitle>Notification preferences</SectionTitle>
          <p className="mb-3 text-xs text-muted">In-app is live. SMS, WhatsApp and email deliver once those providers are connected.</p>
          <table className="w-full text-sm"><thead><tr className="text-xs text-muted"><th scope="col" className="text-left font-medium">Category</th>{['In-app', 'SMS', 'WhatsApp', 'Email'].map((h) => <th key={h} scope="col" className="font-medium">{h}</th>)}</tr></thead>
            <tbody>{Object.entries(pref.preferences).map(([cat, p]) => <tr key={cat} className="border-t border-line"><th scope="row" className="py-2 text-left font-medium">{humanize(cat)}</th>{(['inApp', 'sms', 'whatsapp', 'email'] as const).map((ch) => <td key={ch} className="text-center"><span className="inline-flex"><Toggle label={`${cat} ${ch}`} checked={p[ch]} onChange={(v) => void setCh(cat, ch, v)} /></span></td>)}</tr>)}</tbody></table>
        </Card>
        <Card className="space-y-3 p-5">
          <SectionTitle>Booking alerts</SectionTitle>
          <Checkbox label="New bookings on my routes" checked={alerts.newBookings} onChange={(v) => setAlerts((a) => ({ ...a, newBookings: v }))} />
          <Checkbox label="Bookings about to expire" checked={alerts.expiring} onChange={(v) => setAlerts((a) => ({ ...a, expiring: v }))} />
          <TextField label="Minimum freight (₹)" type="number" value={alerts.minFreight} onChange={(e) => setAlerts((a) => ({ ...a, minFreight: e.target.value }))} />
          <ActionButton variant="primary" action={() => api.put('/transporters/me/preferences', { bookingAlerts: { newBookings: alerts.newBookings, expiring: alerts.expiring, minFreight: alerts.minFreight ? Number(alerts.minFreight) : null } })} success="Preferences saved">Save</ActionButton>
        </Card>
      </div>
      <section className="mt-6"><SectionTitle>Login history</SectionTitle>{logins.length === 0 ? <p className="text-sm text-muted">No history.</p> : <DataTable rows={logins} rowKey={(l) => l.id} columns={[{ key: 'e', label: 'Event', render: (l) => humanize(l.event) }, { key: 'm', label: 'Method', render: (l) => (l.method ? humanize(l.method) : '—') }, { key: 'i', label: 'IP', render: (l) => l.ipAddress ?? '—' }, { key: 'd', label: 'Time', render: (l) => dateTimeIST(l.createdAt) }]} />}</section>
    </>
  );
}
