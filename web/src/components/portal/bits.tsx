'use client';

import clsx from 'clsx';
import { Check, Download, Eye, ShieldCheck, Star } from 'lucide-react';
import { StatusBadge } from '@/components/ui/kit';
import { dateTimeIST } from '@/lib/format';
import { BOOKING_FLOW, BOOKING_STATUS, OFFER_STATUS, PAYMENT_STATUS, TRIP_STATUS, TICKET_STATUS } from '@/lib/status';

export const BookingStatusBadge = ({ status }: { status: string }) => <StatusBadge map={BOOKING_STATUS} value={status} />;
export const OfferStatusBadge = ({ status }: { status: string }) => <StatusBadge map={OFFER_STATUS} value={status} />;
export const PaymentStatusBadge = ({ status }: { status: string }) => <StatusBadge map={PAYMENT_STATUS} value={status} />;
export const TripStatusBadge = ({ status }: { status: string }) => <StatusBadge map={TRIP_STATUS} value={status} />;
export const TicketStatusBadge = ({ status }: { status: string }) => <StatusBadge map={TICKET_STATUS} value={status} />;

export function Rating({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm font-semibold text-ink" aria-label={`Rating ${value} of 5`}>
      <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden />
      {Number(value).toFixed(1)}
    </span>
  );
}

export function VerifiedTag({ status }: { status: string }) {
  return status === 'APPROVED' ? (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
      <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Verified
    </span>
  ) : (
    <span className="text-xs font-semibold text-orange-700">Unverified</span>
  );
}

/** Links to a server-generated or stored file (cookie-authenticated GET through the same origin). */
export function FileLinks({ href, label = 'Download' }: { href: string; label?: string }) {
  const sep = href.includes('?') ? '&' : '?';
  return (
    <span className="inline-flex items-center gap-1">
      <a href={`${href}${sep}inline=1`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-brand-50" title="Preview">
        <Eye className="h-3.5 w-3.5" aria-hidden /> Preview
      </a>
      <a href={href} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-brand-50" download>
        <Download className="h-3.5 w-3.5" aria-hidden /> {label}
      </a>
    </span>
  );
}

/** Visual progress timeline for a booking. */
export function BookingTimeline({ status, history }: { status: string; history: { toStatus: string; createdAt: string; note: string | null }[] }) {
  if (status === 'CANCELLED' || status === 'DISPUTED') {
    return (
      <ol className="space-y-3">
        {history.map((h, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className={clsx('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', h.toStatus === 'CANCELLED' ? 'bg-red-600' : 'bg-slate-400')} />
            <div>
              <p className="font-medium text-ink">{BOOKING_STATUS[h.toStatus]?.label ?? h.toStatus}</p>
              <p className="text-xs text-muted">
                {dateTimeIST(h.createdAt)}
                {h.note ? ` · ${h.note}` : ''}
              </p>
            </div>
          </li>
        ))}
      </ol>
    );
  }
  // NEGOTIATION is optional: hide it if the booking skipped it.
  const reached = new Set(history.map((h) => h.toStatus));
  const flow = BOOKING_FLOW.filter((s) => s !== 'NEGOTIATION' || reached.has('NEGOTIATION') || status === 'NEGOTIATION');
  const currentIdx = flow.indexOf(status);
  const when = (s: string) => [...history].reverse().find((h) => h.toStatus === s)?.createdAt;
  return (
    <ol className="relative space-y-0">
      {flow.map((s, i) => {
        const done = i < currentIdx || (i === currentIdx && (s === 'COMPLETED'));
        const current = i === currentIdx && s !== 'COMPLETED';
        const at = when(s);
        return (
          <li key={s} className="relative flex gap-3 pb-5 last:pb-0">
            {i < flow.length - 1 && <span className={clsx('absolute left-[11px] top-6 h-[calc(100%-12px)] w-0.5', i < currentIdx ? 'bg-green-500' : 'bg-line')} aria-hidden />}
            <span
              className={clsx(
                'relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold',
                done ? 'border-green-600 bg-green-600 text-white' : current ? 'border-brand-600 bg-white text-brand-700 ring-4 ring-brand-100' : 'border-line bg-white text-muted',
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <div className="-mt-0.5">
              <p className={clsx('text-sm font-medium', done || current ? 'text-ink' : 'text-muted')}>{BOOKING_STATUS[s]?.label}</p>
              {at && <p className="text-xs text-muted">{dateTimeIST(at)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export { PAYMENT_STATUS, TRIP_STATUS };
