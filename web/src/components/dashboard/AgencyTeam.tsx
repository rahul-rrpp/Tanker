'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Copy } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api, applyApiError, parseApiError } from '@/lib/api';
import { ROLE_LABELS, STATUS_LABELS, type RoleName, type VerificationStatus } from '@/lib/types';
import { fullName, phone } from '@/lib/validation';
import { Alert, Badge, Button, Card, SelectField, TextField } from '../ui/primitives';

interface DriverRow {
  id: string;
  licenceNumber: string;
  licenceType: string;
  licenceExpiry: string;
  verificationStatus: VerificationStatus;
  user: { fullName: string; phone: string };
}
interface InvitationRow {
  id: string;
  codeHint: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  revokedAt: string | null;
}
interface MemberRow {
  id: string;
  role: RoleName;
  status: 'ACTIVE' | 'INACTIVE';
  user: { fullName: string; phone: string; accountStatus: string };
}

export function AgencyTeam({ permissions }: { permissions: string[] }) {
  const can = (p: string) => permissions.includes(p);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {can('agency:invitations:manage') && <Invitations />}
      {can('agency:drivers:read') && <Drivers canVerify={can('agency:drivers:verify')} />}
      {can('agency:members:read') && <Members canManage={can('agency:members:manage')} />}
    </div>
  );
}

function Invitations() {
  const [rows, setRows] = useState<InvitationRow[]>([]);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows((await api.get('/agency/invitations')).data.data.invitations);
    } catch (e) {
      setError(parseApiError(e).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const { data } = await api.post('/agency/invitations', { maxUses: 1, expiresInDays: 7 });
      setNewCode(data.data.invitation.code);
      await load();
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    await api.delete(`/agency/invitations/${id}`).catch((e) => setError(parseApiError(e).message));
    await load();
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Driver invitations</h2>
          <p className="text-sm text-muted">Drivers register with a code from you.</p>
        </div>
        <Button size="sm" onClick={create} loading={creating}>
          New code
        </Button>
      </div>
      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {newCode && (
        <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="text-xs font-medium text-brand-800">Share this code now. It won&apos;t be shown again.</p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <code className="text-2xl font-bold tracking-[0.2em] text-brand-900">{newCode}</code>
            <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(newCode)} aria-label="Copy code">
              <Copy className="h-4 w-4" aria-hidden /> Copy
            </Button>
          </div>
        </div>
      )}
      <ul className="mt-4 divide-y divide-line text-sm">
        {rows.length === 0 && <li className="py-3 text-muted">No invitations yet.</li>}
        {rows.map((r) => {
          const expired = new Date(r.expiresAt).getTime() < Date.now();
          const active = !r.revokedAt && !expired && r.usedCount < r.maxUses;
          return (
            <li key={r.id} className="flex items-center justify-between gap-3 py-3">
              <span>
                <span className="font-mono">••••-{r.codeHint}</span>
                <span className="ml-2 text-muted">
                  {r.usedCount}/{r.maxUses} used · expires {new Date(r.expiresAt).toLocaleDateString('en-IN')}
                </span>
              </span>
              {active ? (
                <Button size="sm" variant="ghost" onClick={() => revoke(r.id)}>
                  Revoke
                </Button>
              ) : (
                <Badge>{r.revokedAt ? 'Revoked' : expired ? 'Expired' : 'Used'}</Badge>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Drivers({ canVerify }: { canVerify: boolean }) {
  const [rows, setRows] = useState<DriverRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setRows((await api.get('/agency/drivers')).data.data.drivers);
    } catch (e) {
      setError(parseApiError(e).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function verify(id: string, status: 'APPROVED' | 'REJECTED' | 'SUSPENDED') {
    await api.patch(`/agency/drivers/${id}/verification`, { status }).catch((e) => setError(parseApiError(e).message));
    await load();
  }

  return (
    <Card>
      <h2 className="font-semibold">Drivers</h2>
      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}
      <ul className="mt-4 divide-y divide-line text-sm">
        {rows.length === 0 && <li className="py-3 text-muted">No drivers have registered yet.</li>}
        {rows.map((d) => (
          <li key={d.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span>
              <span className="font-medium text-ink">{d.user.fullName}</span>
              <span className="ml-2 text-muted">{d.user.phone}</span>
              <span className="block font-mono text-xs text-muted">
                {d.licenceNumber} · {d.licenceType} · exp {new Date(d.licenceExpiry).toLocaleDateString('en-IN')}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <Badge tone={d.verificationStatus === 'APPROVED' ? 'success' : d.verificationStatus === 'PENDING_VERIFICATION' ? 'warning' : 'danger'}>
                {STATUS_LABELS[d.verificationStatus]}
              </Badge>
              {canVerify && d.verificationStatus !== 'APPROVED' && (
                <Button size="sm" onClick={() => verify(d.id, 'APPROVED')}>
                  Approve
                </Button>
              )}
              {canVerify && d.verificationStatus === 'PENDING_VERIFICATION' && (
                <Button size="sm" variant="secondary" onClick={() => verify(d.id, 'REJECTED')}>
                  Reject
                </Button>
              )}
              {canVerify && d.verificationStatus === 'APPROVED' && (
                <Button size="sm" variant="secondary" onClick={() => verify(d.id, 'SUSPENDED')}>
                  Suspend
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const memberSchema = z.object({ fullName, phone, role: z.enum(['AGENCY_MANAGER', 'DISPATCHER', 'FINANCE_MANAGER']) });

function Members({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const form = useForm<z.input<typeof memberSchema>, unknown, z.output<typeof memberSchema>>({ resolver: zodResolver(memberSchema) });
  const load = useCallback(async () => {
    try {
      setRows((await api.get('/agency/members')).data.data.members);
    } catch (e) {
      setError(parseApiError(e).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    setSuccess(null);
    try {
      const { data } = await api.post('/agency/members', values);
      setSuccess(data.message);
      form.reset();
      await load();
    } catch (e) {
      setError(applyApiError(e, form.setError, ['fullName', 'phone', 'role']).message);
    }
  });

  async function toggle(m: MemberRow) {
    await api.patch(`/agency/members/${m.id}/status`, { status: m.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }).catch((e) => setError(parseApiError(e).message));
    await load();
  }

  return (
    <Card className="lg:col-span-2">
      <h2 className="font-semibold">Team</h2>
      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {success && (
        <div className="mt-4">
          <Alert tone="success">{success}</Alert>
        </div>
      )}
      <ul className="mt-4 divide-y divide-line text-sm">
        {rows.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 py-3">
            <span>
              <span className="font-medium text-ink">{m.user.fullName}</span>
              <span className="ml-2 text-muted">
                {m.user.phone} · {ROLE_LABELS[m.role]}
              </span>
            </span>
            <span className="flex items-center gap-2">
              {m.user.accountStatus === 'PENDING_VERIFICATION' && <Badge tone="warning">Not activated</Badge>}
              <Badge tone={m.status === 'ACTIVE' ? 'success' : 'neutral'}>{m.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge>
              {canManage && m.role !== 'AGENCY_OWNER' && m.role !== 'DRIVER' && (
                <Button size="sm" variant="ghost" onClick={() => toggle(m)}>
                  {m.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {canManage && (
        <form onSubmit={onSubmit} noValidate className="mt-6 grid gap-4 border-t border-line pt-6 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-start">
          <TextField label="Full name" error={form.formState.errors.fullName?.message} required {...form.register('fullName')} />
          <TextField label="Mobile number" prefix="+91" inputMode="tel" error={form.formState.errors.phone?.message} required {...form.register('phone')} />
          <SelectField
            label="Role"
            placeholder="Select role"
            options={(['AGENCY_MANAGER', 'DISPATCHER', 'FINANCE_MANAGER'] as const).map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
            error={form.formState.errors.role?.message}
            required
            {...form.register('role')}
          />
          <Button type="submit" className="sm:mt-7" loading={form.formState.isSubmitting}>
            Add member
          </Button>
        </form>
      )}
    </Card>
  );
}
