'use client';

import { CreditCard, IndianRupee, RotateCcw, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { FileLinks, PaymentStatusBadge } from '@/components/portal/bits';
import { PayButton } from '@/components/portal/PayFlow';
import { DemoBadge, EmptyState, ErrorBlock, LoadingBlock, PageHeader, SectionTitle, StatCard } from '@/components/ui/kit';
import { Alert, Card } from '@/components/ui/primitives';
import type { Payment } from '@/lib/company-types';
import { dateTimeIST, dayOnly, inr } from '@/lib/format';
import { PAYMENT_METHODS } from '@/lib/status';
import { useApi } from '@/lib/useApi';

interface Summary {
  provider: 'RAZORPAY' | 'MOCK';
  totals: { freight: number; invoiced: number; paid: number; outstanding: number; refunded: number; refundPending: number };
  outstanding: { bookingId: string; bookingCode: string; isDemo: boolean; route: string; invoiceNumber: string; total: number; paid: number; due: number; paymentStatus: string; dueAt: string | null }[];
}

interface Breakdown {
  booking: { id: string; bookingCode: string; status: string; paymentStatus: string };
  invoice: { id: string; invoiceNumber: string } | null;
  invoices: { id: string; invoiceNumber: string; totalAmount: number }[];
  breakdown: {
    agreedFreight: number | null;
    platformFee: number | null;
    platformFeePercent: number;
    gstPercent: number;
    gstAmount: number | null;
    totalPayable: number;
    advancePercent: number;
    advanceAmount: number;
    paidAmount: number;
    remainingAmount: number;
  };
  paymentStatus: string;
  canPayAdvance: boolean;
  canPayBalance: boolean;
  provider: 'RAZORPAY' | 'MOCK';
}

function BookingBreakdown({ bookingId, onPaid }: { bookingId: string; onPaid: () => void }) {
  const { data, error, mutate } = useApi<Breakdown>(`/bookings/${bookingId}/payment`);
  if (error) return <ErrorBlock error={error} />;
  if (!data) return <LoadingBlock rows={3} />;
  const b = data.breakdown;
  const refresh = () => {
    void mutate();
    onPaid();
  };
  return (
    <Card>
      <SectionTitle action={<PaymentStatusBadge status={data.paymentStatus} />}>
        Payment breakdown ·{' '}
        <Link href={`/company/bookings/${bookingId}`} className="text-brand-700 hover:underline">
          {data.booking.bookingCode}
        </Link>
      </SectionTitle>
      {!data.invoice ? (
        <Alert tone="info">Payment details are available after you accept a transporter offer for this booking.</Alert>
      ) : (
        <>
          <dl className="space-y-2 text-sm">
            {[
              ['Agreed freight', inr(b.agreedFreight, { decimals: true })],
              [`Platform fee (${b.platformFeePercent}%)`, inr(b.platformFee, { decimals: true })],
              [`GST (${b.gstPercent}%, where applicable)`, inr(b.gstAmount, { decimals: true })],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <dt className="text-muted">{k}</dt>
                <dd className="tabular-nums">{v}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-line pt-2 font-semibold">
              <dt>Total payable</dt>
              <dd className="tabular-nums">{inr(b.totalPayable, { decimals: true })}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Advance ({b.advancePercent}%)</dt>
              <dd className="tabular-nums">{inr(b.advanceAmount, { decimals: true })}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Paid so far</dt>
              <dd className="tabular-nums text-green-700">{inr(b.paidAmount, { decimals: true })}</dd>
            </div>
            <div className="flex justify-between text-base font-bold">
              <dt>Remaining amount</dt>
              <dd className="tabular-nums">{inr(b.remainingAmount, { decimals: true })}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            {data.canPayAdvance && <PayButton bookingId={bookingId} purpose="ADVANCE" amount={b.advanceAmount} label="Pay advance" onDone={refresh} />}
            {data.canPayAdvance && <PayButton bookingId={bookingId} purpose="FULL" amount={b.remainingAmount} label="Pay in full" variant="secondary" onDone={refresh} />}
            {!data.canPayAdvance && data.canPayBalance && <PayButton bookingId={bookingId} purpose="BALANCE" amount={b.remainingAmount} label="Pay balance" onDone={refresh} />}
            {data.invoices.map((inv) => (
              <FileLinks key={inv.id} href={`/api/v1/documents/FREIGHT_INVOICE:${inv.id}`} label={inv.invoiceNumber} />
            ))}
          </div>
          {data.invoices.length > 1 && <p className="mt-3 text-xs text-muted">This booking is split across {data.invoices.length} transporter allocations; totals combine every allocation invoice.</p>}
          <p className="mt-3 text-xs text-muted">Methods: UPI, Debit card, Credit card, Net Banking via {data.provider === 'MOCK' ? 'the development payment simulator' : 'Razorpay'}. Payments are confirmed only after server-side verification with the gateway.</p>
        </>
      )}
    </Card>
  );
}

function PaymentsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const booking = params.get('booking');
  const summary = useApi<Summary>('/payments/summary');
  const history = useApi<{ payments: Payment[] }>(`/payments${booking ? `?bookingId=${booking}` : ''}`);
  const reload = () => {
    void summary.mutate();
    void history.mutate();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Payments" subtitle="Freight invoices, advances, balances and receipts." />
      {summary.data?.provider === 'MOCK' && (
        <Alert tone="info">Test mode: payments run through the development payment simulator. Connect Razorpay test keys to use the real hosted checkout.</Alert>
      )}
      {summary.error ? (
        <ErrorBlock error={summary.error} onRetry={() => summary.mutate()} />
      ) : !summary.data ? (
        <LoadingBlock rows={2} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Total freight" value={inr(summary.data.totals.freight)} icon={<IndianRupee className="h-5 w-5" />} tone="navy" hint={`${inr(summary.data.totals.invoiced)} incl. fee & GST`} />
          <StatCard label="Amount paid" value={inr(summary.data.totals.paid)} icon={<Wallet className="h-5 w-5" />} tone="green" />
          <StatCard label="Amount pending" value={inr(summary.data.totals.outstanding)} icon={<CreditCard className="h-5 w-5" />} tone="orange" />
          <StatCard label="Total refunds" value={inr(summary.data.totals.refunded)} icon={<RotateCcw className="h-5 w-5" />} hint={summary.data.totals.refundPending ? `${inr(summary.data.totals.refundPending)} pending` : 'None pending'} />
        </div>
      )}

      {booking && <BookingBreakdown bookingId={booking} onPaid={reload} />}

      {summary.data && (
        <Card className="!p-0">
          <div className="p-5 pb-0 sm:p-6 sm:pb-0">
            <SectionTitle>Outstanding payments</SectionTitle>
          </div>
          {summary.data.outstanding.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted">Nothing outstanding. 🎉</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-6 py-3 font-medium">Booking</th>
                    <th className="px-3 py-3 font-medium">Invoice</th>
                    <th className="px-3 py-3 text-right font-medium">Total</th>
                    <th className="px-3 py-3 text-right font-medium">Paid</th>
                    <th className="px-3 py-3 text-right font-medium">Due</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {summary.data.outstanding.map((o) => (
                    <tr key={o.bookingId} className="border-b border-line last:border-0">
                      <td className="px-6 py-3">
                        <Link href={`/company/bookings/${o.bookingId}`} className="font-semibold text-brand-700 hover:underline">
                          {o.bookingCode}
                        </Link>{' '}
                        {o.isDemo && <DemoBadge />}
                        <p className="text-xs text-muted">{o.route}</p>
                      </td>
                      <td className="px-3 py-3">
                        {o.invoiceNumber}
                        <p className="text-xs text-muted">Due {dayOnly(o.dueAt)}</p>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{inr(o.total)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-green-700">{inr(o.paid)}</td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">{inr(o.due)}</td>
                      <td className="px-3 py-3">
                        <PaymentStatusBadge status={o.paymentStatus} />
                      </td>
                      <td className="px-6 py-3 text-right">
                        <button onClick={() => router.push(`/company/payments?booking=${o.bookingId}`)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">
                          Pay now
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card className="!p-0">
        <div className="flex flex-wrap items-end justify-between gap-3 p-5 pb-0 sm:p-6 sm:pb-0">
          <SectionTitle>Payment history{booking ? ' (this booking)' : ''}</SectionTitle>
          {booking && (
            <Link href="/company/payments" className="mb-4 text-sm font-semibold text-brand-600">
              Show all payments
            </Link>
          )}
        </div>
        {history.error ? (
          <div className="p-6">
            <ErrorBlock error={history.error} />
          </div>
        ) : !history.data ? (
          <div className="p-6">
            <LoadingBlock rows={3} />
          </div>
        ) : history.data.payments.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No payments yet">Payments you make for confirmed bookings appear here with downloadable receipts.</EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-3 py-3 font-medium">Booking</th>
                  <th className="px-3 py-3 font-medium">Purpose</th>
                  <th className="px-3 py-3 font-medium">Method</th>
                  <th className="px-3 py-3 text-right font-medium">Amount</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {history.data.payments.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-6 py-3 text-muted">{dateTimeIST(p.paidAt ?? p.createdAt)}</td>
                    <td className="px-3 py-3">
                      <Link href={`/company/payments?booking=${p.bookingId}`} className="font-semibold text-brand-700 hover:underline">
                        {p.booking?.bookingCode}
                      </Link>{' '}
                      {(p.provider === 'MOCK' || p.booking?.isDemo) && <DemoBadge label="Test" />}
                    </td>
                    <td className="px-3 py-3 capitalize">{p.purpose.toLowerCase()}</td>
                    <td className="px-3 py-3">{p.method ? (PAYMENT_METHODS[p.method] ?? p.method) : '—'}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{inr(p.amount, { decimals: true })}</td>
                    <td className="px-3 py-3">
                      <PaymentStatusBadge status={p.status} />
                      {p.failureReason && <p className="text-xs text-muted">{p.failureReason}</p>}
                    </td>
                    <td className="px-6 py-3">{p.receiptNumber ? <FileLinks href={`/api/v1/payments/${p.id}/receipt.pdf`} label={p.receiptNumber} /> : <span className="text-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <PaymentsInner />
    </Suspense>
  );
}

