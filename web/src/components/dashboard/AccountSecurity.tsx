'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Monitor, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { api, applyApiError, parseApiError } from '@/lib/api';
import { changePasswordSchema } from '@/lib/validation';
import { Alert, Badge, Button, Card, PasswordField } from '../ui/primitives';
import { LogoutButton } from './LogoutButton';

interface SessionRow {
  id: string;
  clientType: 'WEB' | 'MOBILE';
  deviceInfo: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  current: boolean;
}

export function AccountSecurity({ hasPassword }: { hasPassword: boolean }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Sessions />
      <ChangePassword hasPassword={hasPassword} />
    </div>
  );
}

function Sessions() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setRows((await api.get('/auth/sessions')).data.data.sessions);
    } catch (e) {
      setError(parseApiError(e).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    await api.delete(`/auth/sessions/${id}`).catch((e) => setError(parseApiError(e).message));
    await load();
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Active sessions</h2>
        <LogoutButton all variant="secondary" />
      </div>
      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}
      <ul className="mt-4 divide-y divide-line text-sm">
        {rows.map((s) => {
          const Icon = s.clientType === 'MOBILE' ? Smartphone : Monitor;
          return (
            <li key={s.id} className="flex items-center justify-between gap-3 py-3">
              <span className="flex min-w-0 items-center gap-3">
                <Icon className="h-5 w-5 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{s.deviceInfo ?? (s.clientType === 'MOBILE' ? 'Mobile app' : 'Web browser')}</span>
                  <span className="block truncate text-xs text-muted">
                    {s.ipAddress ?? 'Unknown IP'} · signed in {new Date(s.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                </span>
              </span>
              {s.current ? (
                <Badge tone="success">This device</Badge>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => revoke(s.id)}>
                  Revoke
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ChangePassword({ hasPassword }: { hasPassword: boolean }) {
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const form = useForm<z.infer<typeof changePasswordSchema>>({ resolver: zodResolver(changePasswordSchema) });
  const onSubmit = form.handleSubmit(async (values) => {
    setMessage(null);
    try {
      const { data } = await api.post('/auth/change-password', values);
      setMessage({ tone: 'success', text: data.message });
      form.reset();
    } catch (e) {
      const err = applyApiError(e, form.setError, ['currentPassword', 'password', 'confirmPassword']);
      if (err.code === 'INVALID_CREDENTIALS') form.setError('currentPassword', { message: err.message });
      else setMessage({ tone: 'error', text: err.message });
    }
  });
  return (
    <Card>
      <h2 className="font-semibold">{hasPassword ? 'Change password' : 'Set a password'}</h2>
      {!hasPassword && <p className="mt-1 text-sm text-muted">You currently sign in with OTP. Add a password to also sign in with it.</p>}
      <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        {hasPassword && (
          <PasswordField label="Current password" autoComplete="current-password" error={form.formState.errors.currentPassword?.message} required {...form.register('currentPassword')} />
        )}
        <PasswordField label="New password" autoComplete="new-password" error={form.formState.errors.password?.message} required {...form.register('password')} />
        <PasswordField label="Confirm new password" autoComplete="new-password" error={form.formState.errors.confirmPassword?.message} required {...form.register('confirmPassword')} />
        <Button type="submit" loading={form.formState.isSubmitting}>
          Update password
        </Button>
      </form>
    </Card>
  );
}
