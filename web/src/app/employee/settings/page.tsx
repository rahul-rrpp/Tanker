'use client';

import { useState } from 'react';
import { Section } from '@/components/employee/kit';
import { DataTable } from '@/components/transporter/ui';
import { LoadingBlock, PageHeader, Toggle, useToast } from '@/components/ui/kit';
import { Alert, Button, PasswordField } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';
import { dateTimeIST, humanize } from '@/lib/format';
import { useApi } from '@/lib/useApi';

type Prefs = Record<string, { inApp: boolean; sms: boolean; whatsapp: boolean; email: boolean }>;
type Login = { id: string; event: string; success: boolean; ipAddress: string | null; createdAt: string };

export default function Page() {
  const toast = useToast();
  const { data: pref, mutate } = useApi<{ preferences: Prefs }>('/notifications/preferences');
  const { data: hist } = useApi<{ history?: Login[]; items?: Login[] }>('/auth/login-history');
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [fail, setFail] = useState<string | null>(null);
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value })) });
  const change = async () => {
    setFail(null);
    try {
      await api.post('/auth/change-password', f);
      toast.success('Password changed');
      setF({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (e) {
      setFail(parseApiError(e).message);
    }
  };
  if (!pref) return <LoadingBlock />;
  const set = async (cat: string, ch: string, v: boolean) => {
    try {
      await api.put('/notifications/preferences', { preferences: { ...pref.preferences, [cat]: { ...pref.preferences[cat], [ch]: v } } });
      void mutate();
    } catch (e) {
      toast.error(e);
    }
  };
  const logins = hist?.history ?? hist?.items ?? [];
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Change password"><div className="space-y-3">{fail && <Alert tone="error">{fail}</Alert>}<PasswordField label="Current password" {...bind('currentPassword')} /><PasswordField label="New password" {...bind('newPassword')} /><PasswordField label="Confirm new password" {...bind('confirmPassword')} /><Button size="sm" disabled={!f.currentPassword || !f.newPassword} onClick={() => void change()}>Change password</Button></div></Section>
        <Section title="Notification preferences"><p className="mb-2 text-xs text-muted">In-app is live. SMS, WhatsApp and email deliver once providers are connected.</p><table className="w-full text-sm"><thead><tr className="text-xs text-muted"><th scope="col" className="text-left font-medium">Category</th>{['In-app', 'SMS', 'WhatsApp', 'Email'].map((h) => <th key={h} scope="col" className="font-medium">{h}</th>)}</tr></thead><tbody>{Object.entries(pref.preferences).map(([c, p]) => <tr key={c} className="border-t border-line"><th scope="row" className="py-2 text-left font-medium">{humanize(c)}</th>{(['inApp', 'sms', 'whatsapp', 'email'] as const).map((ch) => <td key={ch} className="text-center"><span className="inline-flex"><Toggle label={`${c} ${ch}`} checked={p[ch]} onChange={(v) => void set(c, ch, v)} /></span></td>)}</tr>)}</tbody></table></Section>
      </div>
      <div className="mt-6"><Section title="Login history">{logins.length === 0 ? <p className="text-sm text-muted">No history.</p> : <DataTable rows={logins} rowKey={(l) => l.id} columns={[{ key: 'e', label: 'Event', render: (l) => humanize(l.event) }, { key: 'i', label: 'IP', render: (l) => l.ipAddress ?? '—' }, { key: 'd', label: 'Time', render: (l) => dateTimeIST(l.createdAt) }]} />}</Section></div>
    </>
  );
}
