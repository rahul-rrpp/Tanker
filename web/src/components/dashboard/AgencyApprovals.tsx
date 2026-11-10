'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, parseApiError } from '@/lib/api';
import { STATUS_LABELS, type VerificationStatus } from '@/lib/types';
import { Alert, Badge, Button, Card } from '../ui/primitives';

interface AgencyRow {
  id: string;
  companyName: string;
  gstNumber: string | null;
  panNumber: string;
  city: string;
  state: string;
  verificationStatus: VerificationStatus;
  createdAt: string;
  owner: { fullName: string; phone: string; email: string | null };
}

const FILTERS: (VerificationStatus | 'ALL')[] = ['PENDING_VERIFICATION', 'APPROVED', 'REJECTED', 'SUSPENDED', 'ALL'];
const tone = (s: VerificationStatus) => (s === 'APPROVED' ? 'success' : s === 'PENDING_VERIFICATION' ? 'warning' : 'danger');

export function AgencyApprovals() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('PENDING_VERIFICATION');
  const [rows, setRows] = useState<AgencyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data } = await api.get('/admin/agencies', { params: filter === 'ALL' ? {} : { status: filter } });
      setRows(data.data.agencies);
    } catch (e) {
      setError(parseApiError(e).message);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, status: 'APPROVED' | 'REJECTED' | 'SUSPENDED') {
    let reason: string | undefined;
    if (status !== 'APPROVED') {
      reason = window.prompt(`Reason for ${status.toLowerCase()} (shown to the agency owner):`)?.trim();
      if (!reason) return;
    }
    setBusy(id);
    try {
      await api.patch(`/admin/agencies/${id}/verification`, { status, reason });
      await load();
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="font-semibold">Agency verification</h2>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === f ? 'bg-brand-600 text-white' : 'bg-slate-100 text-muted hover:text-ink'}`}
            >
              {f === 'ALL' ? 'All' : STATUS_LABELS[f]}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <div className="p-5">
          <Alert>{error}</Alert>
        </div>
      )}
      {rows === null ? (
        <p className="p-5 text-sm text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="p-5 text-sm text-muted">No agencies in this list.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink">{a.companyName}</p>
                  <Badge tone={tone(a.verificationStatus)}>{STATUS_LABELS[a.verificationStatus]}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {a.owner.fullName} · {a.owner.phone} · {a.city}, {a.state}
                </p>
                <p className="mt-0.5 font-mono text-xs text-muted">
                  PAN {a.panNumber}
                  {a.gstNumber ? ` · GST ${a.gstNumber}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {a.verificationStatus !== 'APPROVED' && (
                  <Button size="sm" onClick={() => decide(a.id, 'APPROVED')} loading={busy === a.id}>
                    Approve
                  </Button>
                )}
                {a.verificationStatus === 'PENDING_VERIFICATION' && (
                  <Button size="sm" variant="secondary" onClick={() => decide(a.id, 'REJECTED')} disabled={busy === a.id}>
                    Reject
                  </Button>
                )}
                {a.verificationStatus === 'APPROVED' && (
                  <Button size="sm" variant="secondary" onClick={() => decide(a.id, 'SUSPENDED')} disabled={busy === a.id}>
                    Suspend
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
