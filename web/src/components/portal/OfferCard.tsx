'use client';

import clsx from 'clsx';
import { Building2, CalendarClock, Check, ChevronDown, Clock, MessageSquareReply, Truck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DemoButton } from '@/components/portal/DemoPanel';
import { DemoBadge, Modal, TextArea, useToast } from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';
import type { Catalog, Offer } from '@/lib/company-types';
import { dateTimeIST, inr, kl, timeAgo } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { OfferStatusBadge, Rating, VerifiedTag } from './bits';

/** Offer status after each negotiation step. */
const HISTORY_STATUS: Record<string, string> = {
  OFFER_SUBMITTED: 'Offer submitted',
  CUSTOMER_PRICE_ACCEPTED: 'Price accepted by transporter',
  COUNTER_OFFER: 'Counter-offer',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  WITHDRAWN: 'Withdrawn',
  CLOSED: 'Closed',
};

const ACTION_TEXT: Record<string, string> = {
  OFFER_SUBMITTED: 'quoted',
  CUSTOMER_PRICE_ACCEPTED: 'accepted the price of',
  COUNTER_OFFER: 'countered with',
  ACCEPTED: 'accepted at',
  REJECTED: 'rejected the offer',
  EXPIRED: 'Offer expired',
  WITHDRAWN: 'withdrew the offer',
  CLOSED: 'Offer closed',
};

function expiresIn(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h ? `${h} h ${m} min left` : `${m} min left`;
}

export function OfferCard({
  offer,
  customerOffer,
  best,
  bookingOpen,
  onChanged,
  onAccepted,
  tankersNeeded = 1,
  tankersAllocated = 0,
}: {
  offer: Offer;
  customerOffer: number;
  best?: boolean;
  bookingOpen: boolean;
  onChanged: () => void;
  onAccepted: (bookingId: string, confirmed: boolean) => void;
  tankersNeeded?: number;
  tankersAllocated?: number;
}) {
  const toast = useToast();
  const { data: catalog } = useApi<Catalog>('/catalog', { revalidateOnFocus: false });
  const [showHistory, setShowHistory] = useState(false);
  const [counterOpen, setCounterOpen] = useState(false);
  const [confirmAccept, setConfirmAccept] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [counterAmount, setCounterAmount] = useState('');
  const [counterMsg, setCounterMsg] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);

  const remaining = Math.max(0, tankersNeeded - tankersAllocated);
  const allocateNow = Math.min(offer.tankersAvailable, remaining);
  const perTanker = offer.currentAmount / Math.max(1, offer.tankersAvailable);
  const acceptAmount = allocateNow === offer.tankersAvailable ? offer.currentAmount : Math.round(perTanker * allocateNow * 100) / 100;
  // Compare like with like: the customer's offer scaled to the tankers this transporter covers.
  const customerEquivalent = (customerOffer / Math.max(1, tankersNeeded)) * offer.tankersAvailable;
  const awaitingCompany = offer.status === 'PENDING' && bookingOpen && remaining > 0;
  const awaitingTransporter = offer.status === 'COUNTERED' && bookingOpen;
  const diff = Math.round(offer.currentAmount - customerEquivalent);
  const t = offer.transporter;
  const lastTransporterMove = [...(offer.history ?? [])].reverse().find((h) => h.party === 'TRANSPORTER');
  const transporterAcceptedCounter = offer.status === 'PENDING' && lastTransporterMove?.action === 'CUSTOMER_PRICE_ACCEPTED' && offer.round > 1;

  useEffect(() => {
    if (counterOpen) {
      setCounterAmount(String(Math.round((offer.currentAmount + customerOffer) / 2 / 10) * 10));
      setCounterMsg('');
      setDialogError(null);
    }
  }, [counterOpen, offer.currentAmount, customerOffer]);

  async function act(kind: string, fn: () => Promise<unknown>, success: string) {
    setBusy(kind);
    setDialogError(null);
    try {
      await fn();
      toast.success(success);
      return true;
    } catch (e) {
      setDialogError(parseApiError(e).message);
      toast.error(e);
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={clsx('rounded-2xl border bg-white p-5 shadow-[var(--shadow-card)]', best && awaitingCompany ? 'border-green-300 ring-2 ring-green-100' : 'border-line', !['PENDING', 'COUNTERED', 'ACCEPTED'].includes(offer.status) && 'opacity-75')}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-ink">{t.companyName}</h3>
            {t.isDemo && <DemoBadge label="Demo offer" />}
            {best && awaitingCompany && <span className="rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">Lowest price</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <Rating value={t.rating} />
            <VerifiedTag status={t.verificationStatus} />
            <span>{t.completedTrips.toLocaleString('en-IN')} trips completed</span>
            <span>
              {t.city}, {t.state}
            </span>
          </div>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-xs text-muted">{offer.status === 'COUNTERED' ? 'Your counter-offer' : offer.status === 'ACCEPTED' ? 'Agreed freight' : 'Offered freight'}</p>
          <p className="text-2xl font-bold tabular-nums text-ink">{inr(offer.currentAmount)}</p>
          <p className={clsx('text-xs font-medium', diff > 0 ? 'text-orange-700' : diff < 0 ? 'text-green-700' : 'text-muted')}>
            {diff === 0 ? 'Matches your offer' : `${diff > 0 ? '+' : '−'}${inr(Math.abs(diff))} vs your offer`}
          </p>
          {tankersNeeded > 1 && (
            <p className="text-xs text-muted">
              {inr(perTanker)} per tanker · covers {offer.tankersAvailable} of {tankersNeeded}
            </p>
          )}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div className="rounded-xl bg-canvas p-2.5">
          <dt className="flex items-center gap-1 text-xs text-muted"><Truck className="h-3.5 w-3.5" /> Tankers available</dt>
          <dd className="mt-0.5 font-semibold">{offer.tankersAvailable}</dd>
        </div>
        <div className="rounded-xl bg-canvas p-2.5">
          <dt className="text-xs text-muted">Tanker capacity</dt>
          <dd className="mt-0.5 font-semibold">{kl(offer.tankerCapacityKl)}</dd>
        </div>
        <div className="rounded-xl bg-canvas p-2.5">
          <dt className="flex items-center gap-1 text-xs text-muted"><CalendarClock className="h-3.5 w-3.5" /> Availability</dt>
          <dd className="mt-0.5 font-semibold">{dateTimeIST(offer.estimatedAvailabilityAt)}</dd>
        </div>
        <div className="rounded-xl bg-canvas p-2.5">
          <dt className="flex items-center gap-1 text-xs text-muted"><Clock className="h-3.5 w-3.5" /> Submitted</dt>
          <dd className="mt-0.5 font-semibold">{timeAgo(offer.createdAt)}</dd>
        </div>
      </dl>

      {offer.remarks && <p className="mt-3 text-sm text-muted">“{offer.remarks}”</p>}
      {transporterAcceptedCounter && (
        <div className="mt-3">
          <Alert tone="success">{t.companyName} accepted your counter-offer. Accept below to confirm the booking at this price.</Alert>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <OfferStatusBadge status={offer.status} />
          {(offer.status === 'PENDING' || offer.status === 'COUNTERED') && <span>{expiresIn(offer.expiresAt)}</span>}
          <span>Round {offer.round}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => setProfileOpen(true)}>
            <Building2 className="h-4 w-4" /> Transporter profile
          </Button>
          {awaitingCompany && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setRejectOpen(true)}>
                <X className="h-4 w-4" /> Reject
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setCounterOpen(true)}>
                <MessageSquareReply className="h-4 w-4" /> Counter-offer
              </Button>
              <Button size="sm" className="!bg-green-600 hover:!bg-green-700" onClick={() => setConfirmAccept(true)}>
                <Check className="h-4 w-4" /> Accept {inr(acceptAmount)}
                {tankersNeeded > 1 ? ` for ${allocateNow} tanker${allocateNow > 1 ? 's' : ''}` : ''}
              </Button>
            </>
          )}
          {awaitingTransporter && (
            <Button variant="secondary" size="sm" onClick={() => setRejectOpen(true)}>
              <X className="h-4 w-4" /> Withdraw interest
            </Button>
          )}
        </div>
      </div>

      {awaitingTransporter && t.isDemo && catalog?.demoMode && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-fuchsia-300 bg-fuchsia-50/60 p-3">
          <span className="text-xs font-semibold text-fuchsia-800">Demo: simulate transporter reply →</span>
          <DemoButton loading={busy === 'demo-accept'} onClick={() => act('demo-accept', () => api.post(`/demo/offers/${offer.id}/respond`, { action: 'ACCEPT' }), 'Demo transporter accepted your counter-offer').then(onChanged)}>
            Accept counter
          </DemoButton>
          <DemoButton loading={busy === 'demo-counter'} onClick={() => act('demo-counter', () => api.post(`/demo/offers/${offer.id}/respond`, { action: 'COUNTER' }), 'Demo transporter sent a new counter-offer').then(onChanged)}>
            Counter again
          </DemoButton>
        </div>
      )}

      {(offer.history?.length ?? 0) > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowHistory((s) => !s)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600" aria-expanded={showHistory}>
            <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', showHistory && 'rotate-180')} /> Negotiation history ({offer.history!.length})
          </button>
          {showHistory && (
            <ol className="mt-3 space-y-2 border-l-2 border-line pl-4">
              {offer.history!.map((h) => (
                <li key={h.id} className="text-sm">
                  <span className={clsx('font-semibold', h.party === 'COMPANY' ? 'text-brand-700' : h.party === 'TRANSPORTER' ? 'text-ink' : 'text-muted')}>
                    {h.party === 'COMPANY' ? 'You' : h.party === 'TRANSPORTER' ? t.companyName : 'System'}
                  </span>{' '}
                  <span className="text-muted">{ACTION_TEXT[h.action] ?? h.action.toLowerCase()}</span>
                  {h.amount !== null && <span className="font-semibold tabular-nums"> {inr(h.amount)}</span>}
                  {h.message && <span className="text-muted"> — “{h.message}”</span>}
                  <span className="block text-xs text-muted">
                    {dateTimeIST(h.createdAt)} · <span className="font-medium">{HISTORY_STATUS[h.action] ?? h.action}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* Accept */}
      <Modal
        open={confirmAccept}
        onClose={() => setConfirmAccept(false)}
        title="Confirm this transporter?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmAccept(false)}>
              Not yet
            </Button>
            <Button
              className="!bg-green-600 hover:!bg-green-700"
              loading={busy === 'accept'}
              onClick={async () => {
                setBusy('accept');
                setDialogError(null);
                try {
                  const { data } = await api.post(`/offers/${offer.id}/accept`);
                  const res = data.data as { confirmed: boolean; tankersRemaining: number };
                  toast.success(res.confirmed ? 'Booking confirmed' : `Allocation confirmed. ${res.tankersRemaining} tanker(s) still to allocate.`);
                  setConfirmAccept(false);
                  onAccepted(offer.bookingId, res.confirmed);
                } catch (e) {
                  setDialogError(parseApiError(e).message);
                } finally {
                  setBusy(null);
                }
              }}
            >
              Accept &amp; confirm booking
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          {dialogError && <Alert>{dialogError}</Alert>}
          <p>
            You are booking <strong>{t.companyName}</strong> for <strong className="text-lg">{inr(acceptAmount)}</strong>
            {tankersNeeded > 1 ? ` (${allocateNow} of ${tankersNeeded} tanker${tankersNeeded > 1 ? 's' : ''})` : ''}.
          </p>
          {allocateNow < offer.tankersAvailable && (
            <Alert tone="info">Only {allocateNow} tanker(s) remain unallocated, so the price is pro-rated from {inr(offer.currentAmount)} for {offer.tankersAvailable}.</Alert>
          )}
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>The freight for this allocation is locked at this amount.</li>
            {allocateNow === remaining ? (
              <li>Every tanker will then be allocated: the booking is confirmed and all other open offers are closed.</li>
            ) : (
              <li>{remaining - allocateNow} tanker(s) will still need a transporter; other offers stay open for them (partial fulfilment).</li>
            )}
            <li>A freight invoice (with platform fee and GST where applicable) is issued for this allocation.</li>
          </ul>
        </div>
      </Modal>

      {/* Counter */}
      <Modal
        open={counterOpen}
        onClose={() => setCounterOpen(false)}
        title={`Counter-offer to ${t.companyName}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCounterOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={busy === 'counter'}
              disabled={!(Number(counterAmount) > 0) || Number(counterAmount) >= offer.currentAmount}
              onClick={async () => {
                if (await act('counter', () => api.post(`/offers/${offer.id}/counter`, { amount: Number(counterAmount), message: counterMsg || undefined }), 'Counter-offer sent')) {
                  setCounterOpen(false);
                  onChanged();
                }
              }}
            >
              Send counter-offer
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {dialogError && <Alert>{dialogError}</Alert>}
          <div className="grid grid-cols-2 gap-2 text-center text-sm">
            <div className="rounded-xl bg-canvas p-2">
              <p className="text-xs text-muted">Your original offer</p>
              <p className="font-semibold">{inr(customerOffer)}</p>
            </div>
            <div className="rounded-xl bg-canvas p-2">
              <p className="text-xs text-muted">Transporter&apos;s price</p>
              <p className="font-semibold">{inr(offer.currentAmount)}</p>
            </div>
          </div>
          <TextField label="Your counter-offer (₹)" type="number" value={counterAmount} onChange={(e) => setCounterAmount(e.target.value)} hint="Must be lower than the transporter's current price." required />
          <TextArea label="Message (optional)" value={counterMsg} onChange={(e) => setCounterMsg(e.target.value)} maxLength={500} placeholder="e.g. Regular lane, repeat business every week" />
        </div>
      </Modal>

      {/* Reject */}
      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={`Reject offer from ${t.companyName}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectOpen(false)}>
              Keep offer
            </Button>
            <Button
              variant="danger"
              loading={busy === 'reject'}
              onClick={async () => {
                if (await act('reject', () => api.post(`/offers/${offer.id}/reject`, { reason: rejectReason || undefined }), 'Offer rejected')) {
                  setRejectOpen(false);
                  onChanged();
                }
              }}
            >
              Reject offer
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {dialogError && <Alert>{dialogError}</Alert>}
          <TextArea label="Reason (optional)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} maxLength={500} />
        </div>
      </Modal>

      <TransporterProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} transporterId={t.id} />
    </div>
  );
}

interface TransporterProfile {
  companyName: string;
  city: string;
  state: string;
  rating: number;
  completedTrips: number;
  verificationStatus: string;
  isDemo: boolean;
  serviceStates: string[];
  createdAt: string;
  fleet: { tankers: number; drivers: number; capacities: number[]; products: string[]; tankerTypes: string[] };
}

export function TransporterProfileModal({ open, onClose, transporterId }: { open: boolean; onClose: () => void; transporterId: string }) {
  const { data, error } = useApi<{ transporter: TransporterProfile }>(open ? `/transporters/${transporterId}` : null);
  const t = data?.transporter;
  return (
    <Modal open={open} onClose={onClose} title="Transporter profile">
      {error ? (
        <Alert>{parseApiError(error).message}</Alert>
      ) : !t ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="space-y-4 text-sm">
          <div>
            <p className="flex flex-wrap items-center gap-2 text-lg font-semibold text-ink">
              {t.companyName} {t.isDemo && <DemoBadge />}
            </p>
            <p className="text-muted">
              {t.city}, {t.state} · on TankerLink since {new Date(t.createdAt).getFullYear()}
            </p>
            <div className="mt-2 flex items-center gap-4">
              <Rating value={t.rating} />
              <VerifiedTag status={t.verificationStatus} />
              <span className="text-muted">{t.completedTrips.toLocaleString('en-IN')} trips</span>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-canvas p-3">
              <dt className="text-xs text-muted">Fleet</dt>
              <dd className="font-semibold">{t.fleet.tankers} tankers · {t.fleet.drivers} drivers</dd>
            </div>
            <div className="rounded-xl bg-canvas p-3">
              <dt className="text-xs text-muted">Capacities</dt>
              <dd className="font-semibold">{t.fleet.capacities.map((c) => `${c} KL`).join(', ')}</dd>
            </div>
            <div className="col-span-2 rounded-xl bg-canvas p-3">
              <dt className="text-xs text-muted">Certified products</dt>
              <dd className="font-semibold">{t.fleet.products.join(', ')}</dd>
            </div>
            <div className="col-span-2 rounded-xl bg-canvas p-3">
              <dt className="text-xs text-muted">Tanker types · service states</dt>
              <dd className="font-semibold">
                {t.fleet.tankerTypes.join(', ')} · {t.serviceStates.join(', ')}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </Modal>
  );
}
