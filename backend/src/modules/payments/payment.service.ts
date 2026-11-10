import { randomBytes } from 'node:crypto';
import { Prisma, type PaymentPurpose, type PaymentStatus } from '@prisma/client';
import type { Request } from 'express';
import { env } from '../../config/env';
import { nextCode } from '../../lib/codes';
import { round2, toPaise } from '../../lib/money';
import { prisma, type Tx } from '../../lib/prisma';
import { AppError, ErrorCode } from '../../utils/errors';
import { audit } from '../audit/audit';
import { notify } from '../notifications/notification.service';
import { getSettings } from '../settings/settings.service';
import { ZERO } from './payment.calc';
import {
  activePaymentProvider,
  createGatewayOrder,
  fetchGatewayPayment,
  mapMethod,
  signatureFor,
  verifySignature,
} from './payment.gateway';

async function ownedBooking(companyId: string, bookingId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, companyId },
    select: { id: true, bookingCode: true, status: true, paymentStatus: true, acceptedFreight: true, isDemo: true },
  });
  if (!booking) throw AppError.notFound('Booking not found');
  return booking;
}

/** Sums every non-cancelled invoice of a booking (one invoice per transporter allocation). */
async function invoiceTotals(tx: Tx, bookingId: string) {
  const invoices = await tx.invoice.findMany({ where: { bookingId, status: { not: 'CANCELLED' } }, orderBy: { issuedAt: 'asc' } });
  const sum = (k: 'freightAmount' | 'platformFee' | 'gstAmount' | 'totalAmount') => invoices.reduce((s, i) => s.plus(i[k]), ZERO);
  return { invoices, freight: sum('freightAmount'), platformFee: sum('platformFee'), gst: sum('gstAmount'), total: sum('totalAmount') };
}

/** Full payment picture for one booking, derived from its invoices and verified payments only. */
export async function paymentBreakdown(companyId: string, bookingId: string) {
  const booking = await ownedBooking(companyId, bookingId);
  const settings = await getSettings();
  const totals = await invoiceTotals(prisma, bookingId);
  const payments = await prisma.payment.findMany({ where: { bookingId, companyId }, orderBy: { createdAt: 'desc' } });
  const paid = payments.filter((p) => p.status === 'PAID').reduce((s, p) => s.plus(p.amount), ZERO);
  const total = totals.total;
  const advance = round2(total.times(settings.advancePercent).dividedBy(100));
  const remaining = Prisma.Decimal.max(ZERO, total.minus(paid));
  // Payable once at least one allocation is invoiced (partial fulfilment) and the booking is not cancelled.
  const payable = totals.invoices.length > 0 && booking.status !== 'CANCELLED' && booking.status !== 'DISPUTED';
  return {
    booking,
    invoice: totals.invoices[totals.invoices.length - 1] ?? null,
    invoices: totals.invoices,
    breakdown: {
      agreedFreight: totals.invoices.length ? totals.freight : (booking.acceptedFreight ?? null),
      platformFee: totals.invoices.length ? totals.platformFee : null,
      platformFeePercent: settings.platformFeePercent,
      gstPercent: totals.invoices[0]?.gstPercent ?? settings.gstPercent,
      gstAmount: totals.invoices.length ? totals.gst : null,
      totalPayable: total,
      advancePercent: settings.advancePercent,
      advanceAmount: advance,
      paidAmount: paid,
      remainingAmount: remaining,
      refundedAmount: payments.filter((p) => p.status === 'REFUNDED').reduce((s, p) => s.plus(p.amount), ZERO),
    },
    paymentStatus: booking.paymentStatus,
    canPayAdvance: payable && paid.isZero() && advance.greaterThan(0) && remaining.greaterThan(0),
    canPayBalance: payable && remaining.greaterThan(0),
    provider: activePaymentProvider(),
    payments,
  };
}

async function recomputeBookingPaymentStatus(tx: Tx, bookingId: string) {
  const { invoices, total } = await invoiceTotals(tx, bookingId);
  const rows = await tx.payment.findMany({ where: { bookingId }, orderBy: { createdAt: 'desc' } });
  if (rows.some((p) => p.status === 'REFUND_PENDING')) return;
  const paidRows = rows.filter((p) => p.status === 'PAID');
  const paid = paidRows.reduce((s, p) => s.plus(p.amount), ZERO);
  let status: PaymentStatus;
  if (total.greaterThan(0) && paid.greaterThanOrEqualTo(total)) status = 'PAID';
  else if (paid.greaterThan(0)) status = paidRows.length === 1 && paidRows[0].purpose === 'ADVANCE' ? 'ADVANCE_PAID' : 'PARTIALLY_PAID';
  else status = rows[0]?.status === 'FAILED' ? 'FAILED' : 'PENDING';
  await tx.booking.update({ where: { id: bookingId }, data: { paymentStatus: status } });
  // Payments settle invoices oldest-first.
  let left = paid;
  for (const inv of invoices) {
    const covered = left.greaterThanOrEqualTo(inv.totalAmount);
    await tx.invoice.update({ where: { id: inv.id }, data: { status: covered ? 'PAID' : left.greaterThan(0) ? 'PARTIALLY_PAID' : 'ISSUED' } });
    left = Prisma.Decimal.max(ZERO, left.minus(inv.totalAmount));
  }
}

export async function createOrder(companyId: string, userId: string, input: { bookingId: string; purpose: PaymentPurpose }, req?: Request) {
  const info = await paymentBreakdown(companyId, input.bookingId);
  const { breakdown } = info;
  if (!info.invoices.length || !info.canPayBalance) {
    throw AppError.conflict('There is nothing payable on this booking right now', ErrorCode.PAYMENT_NOT_ALLOWED);
  }
  let amount: Prisma.Decimal;
  if (input.purpose === 'ADVANCE') {
    if (!info.canPayAdvance) throw AppError.conflict('Advance has already been paid. Pay the balance instead.', ErrorCode.PAYMENT_NOT_ALLOWED);
    amount = breakdown.advanceAmount;
  } else if (input.purpose === 'FULL') {
    if (!breakdown.paidAmount.isZero()) throw AppError.conflict('A payment was already made. Pay the remaining balance instead.', ErrorCode.PAYMENT_NOT_ALLOWED);
    amount = breakdown.remainingAmount;
  } else {
    amount = breakdown.remainingAmount;
  }
  const provider = activePaymentProvider();

  // Idempotency: reuse an unpaid order for the same purpose and amount created in the last 30 minutes.
  const reusable = await prisma.payment.findFirst({
    where: { bookingId: input.bookingId, companyId, purpose: input.purpose, status: 'CREATED', amount, provider, createdAt: { gte: new Date(Date.now() - 30 * 60_000) } },
  });
  const payment =
    reusable ??
    (await (async () => {
      const order = await createGatewayOrder(provider, toPaise(amount), `${info.booking.bookingCode}-${input.purpose}`, {
        bookingId: input.bookingId,
        companyId,
        purpose: input.purpose,
      });
      return prisma.payment.create({
        data: { bookingId: input.bookingId, companyId, purpose: input.purpose, amount, provider, providerOrderId: order.orderId, createdById: userId },
      });
    })());

  await audit({ action: 'payment.order_created', entityType: 'payment', entityId: payment.id, companyId, actorUserId: userId, metadata: { amount: amount.toNumber(), purpose: input.purpose, provider }, req });
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, contactEmail: true, contactPhone: true } });
  return {
    paymentId: payment.id,
    provider,
    orderId: payment.providerOrderId,
    amount: payment.amount,
    amountPaise: toPaise(payment.amount),
    currency: 'INR',
    keyId: provider === 'RAZORPAY' ? env.RAZORPAY_KEY_ID : null,
    description: `${info.booking.bookingCode} - ${input.purpose.toLowerCase()} payment`,
    prefill: { name: company.name, email: company.contactEmail, contact: company.contactPhone },
    testMode: provider === 'MOCK' || (env.RAZORPAY_KEY_ID ?? '').startsWith('rzp_test_'),
  };
}

async function markPaid(paymentId: string, gateway: { paymentId: string; method: string | null; raw: Prisma.InputJsonValue }, actorUserId?: string | null) {
  const result = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (p.status === 'PAID') return { payment: p, changed: false };
    const updated = await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: 'PAID',
        providerPaymentId: gateway.paymentId,
        signatureVerified: true,
        method: mapMethod(gateway.method),
        paidAt: new Date(),
        receiptNumber: await nextCode(tx, 'receipt'),
        gatewayPayload: gateway.raw,
        failureReason: null,
      },
    });
    await recomputeBookingPaymentStatus(tx, p.bookingId);
    await audit({ action: 'payment.verified', entityType: 'payment', entityId: p.id, companyId: p.companyId, actorUserId, actorType: actorUserId ? 'COMPANY' : 'SYSTEM', metadata: { amount: p.amount.toNumber(), providerPaymentId: gateway.paymentId } }, tx);
    return { payment: updated, changed: true };
  });
  if (result.changed) {
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: result.payment.bookingId }, select: { bookingCode: true } });
    await notify({
      companyId: result.payment.companyId,
      type: 'PAYMENT_RECEIVED',
      title: `Payment received for ${booking.bookingCode}`,
      message: `Rs ${result.payment.amount.toNumber().toLocaleString('en-IN')} received. Receipt ${result.payment.receiptNumber}.`,
      bookingId: result.payment.bookingId,
      link: `/company/payments?booking=${result.payment.bookingId}`,
    });
  }
  return result.payment;
}

/**
 * Called by the browser after checkout. The browser's claim of success is NOT trusted: the signature is
 * verified with the gateway secret and the payment is re-fetched from the gateway before marking PAID.
 */
export async function verifyPayment(companyId: string, userId: string, input: { orderId: string; paymentId: string; signature: string }, req?: Request) {
  const payment = await prisma.payment.findFirst({ where: { providerOrderId: input.orderId, companyId } });
  if (!payment) throw AppError.notFound('Payment order not found');
  if (payment.status === 'PAID') return payment;
  if (payment.status !== 'CREATED') throw AppError.conflict(`This payment is ${payment.status.toLowerCase()}`, ErrorCode.PAYMENT_NOT_ALLOWED);

  const reject = async (reason: string) => {
    await audit({ action: 'payment.verification_failed', entityType: 'payment', entityId: payment.id, companyId, actorUserId: userId, metadata: { reason }, req });
    throw AppError.badRequest('Payment could not be verified. If money was debited it will be reconciled automatically.', ErrorCode.PAYMENT_VERIFICATION_FAILED);
  };

  if (payment.provider === 'OFFLINE') throw AppError.conflict('Offline payments are recorded by finance, not verified through the gateway', ErrorCode.PAYMENT_NOT_ALLOWED);
  const provider = payment.provider;
  if (!verifySignature(input.orderId, input.paymentId, input.signature, provider)) return reject('signature_mismatch');
  const mockRecord = payment.provider === 'MOCK' ? ((payment.gatewayPayload as Record<string, unknown> | null)?.mockGateway as Record<string, never> | undefined) : undefined;
  const gw = await fetchGatewayPayment(provider, input.paymentId, mockRecord ?? null);
  if (gw.orderId !== payment.providerOrderId) return reject('order_mismatch');
  if (gw.amountPaise !== toPaise(payment.amount)) return reject('amount_mismatch');
  if (gw.status !== 'captured') return reject(`status_${gw.status}`);
  return markPaid(payment.id, { paymentId: gw.id, method: gw.method, raw: gw.raw as Prisma.InputJsonValue }, userId);
}

/** Records a checkout failure/dismissal reported by the browser (no money moved, safe to accept). */
export async function markOrderFailed(companyId: string, userId: string, input: { orderId: string; reason?: string }) {
  const payment = await prisma.payment.findFirst({ where: { providerOrderId: input.orderId, companyId } });
  if (!payment) throw AppError.notFound('Payment order not found');
  if (payment.status !== 'CREATED') return payment;
  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: (input.reason ?? 'Checkout not completed').slice(0, 300) } });
    await recomputeBookingPaymentStatus(tx, payment.bookingId);
    await audit({ action: 'payment.failed', entityType: 'payment', entityId: payment.id, companyId, actorUserId: userId, metadata: { reason: input.reason ?? null } }, tx);
    return p;
  });
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: payment.bookingId }, select: { bookingCode: true } });
  await notify({ companyId, type: 'PAYMENT_FAILED', title: `Payment not completed for ${booking.bookingCode}`, message: 'Your payment was not completed. No amount was captured. You can retry from Payments.', bookingId: payment.bookingId, link: `/company/payments?booking=${payment.bookingId}` });
  return updated;
}

/** Razorpay webhook (server-to-server, signature-verified by the route). */
export async function handleRazorpayWebhook(event: { event?: string; payload?: { payment?: { entity?: { id: string; order_id: string; amount: number; status: string; method?: string; error_description?: string } } } }) {
  const entity = event.payload?.payment?.entity;
  if (!entity) return { handled: false };
  const payment = await prisma.payment.findUnique({ where: { providerOrderId: entity.order_id } });
  if (!payment || payment.provider !== 'RAZORPAY') return { handled: false };
  if (event.event === 'payment.captured' && entity.status === 'captured' && entity.amount === toPaise(payment.amount)) {
    await markPaid(payment.id, { paymentId: entity.id, method: entity.method ?? null, raw: { webhook: event.event, id: entity.id, status: entity.status } });
    return { handled: true };
  }
  if (event.event === 'payment.failed' && payment.status === 'CREATED') {
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: (entity.error_description ?? 'Payment failed').slice(0, 300) } });
      await recomputeBookingPaymentStatus(tx, payment.bookingId);
    });
    return { handled: true };
  }
  return { handled: false };
}

/**
 * DEVELOPMENT GATEWAY SIMULATOR (PAYMENT_PROVIDER=mock only). Plays the role of the hosted checkout:
 * records the "gateway" payment server-side and returns the signed callback a real gateway would give.
 */
export async function mockCheckout(companyId: string, input: { orderId: string; outcome: 'success' | 'failure'; method: 'upi' | 'netbanking' | 'debit_card' | 'credit_card' }) {
  if (env.PAYMENT_PROVIDER !== 'mock' || env.isProduction) throw AppError.notFound('Not available');
  const payment = await prisma.payment.findFirst({ where: { providerOrderId: input.orderId, companyId, provider: 'MOCK' } });
  if (!payment) throw AppError.notFound('Payment order not found');
  if (payment.status !== 'CREATED') throw AppError.conflict('This order is no longer awaiting payment', ErrorCode.PAYMENT_NOT_ALLOWED);
  const paymentId = `pay_mock_${randomBytes(9).toString('hex')}`;
  const record = {
    paymentId,
    orderId: payment.providerOrderId,
    amountPaise: toPaise(payment.amount),
    status: input.outcome === 'success' ? 'captured' : 'failed',
    method: input.method,
    at: new Date().toISOString(),
  };
  await prisma.payment.update({ where: { id: payment.id }, data: { gatewayPayload: { mockGateway: record } } });
  if (input.outcome === 'failure') return { outcome: 'failure' as const, orderId: payment.providerOrderId, error: 'Payment declined by bank (simulated)' };
  return { outcome: 'success' as const, orderId: payment.providerOrderId, paymentId, signature: signatureFor(payment.providerOrderId, paymentId, 'MOCK') };
}

export async function listPayments(companyId: string, filter: { bookingId?: string; status?: string }) {
  return prisma.payment.findMany({
    where: { companyId, ...(filter.bookingId ? { bookingId: filter.bookingId } : {}), ...(filter.status ? { status: filter.status as never } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { booking: { select: { id: true, bookingCode: true, isDemo: true } } },
  });
}

export async function getPayment(companyId: string, id: string) {
  const p = await prisma.payment.findFirst({ where: { id, companyId }, include: { booking: { select: { id: true, bookingCode: true } } } });
  if (!p) throw AppError.notFound('Payment not found');
  return p;
}

/** Payment overview (per booking, summing all allocation invoices) plus outstanding balances. */
export async function paymentSummary(companyId: string) {
  const invoices = await prisma.invoice.findMany({
    where: { companyId, status: { not: 'CANCELLED' } },
    include: { booking: { select: { id: true, bookingCode: true, status: true, paymentStatus: true, isDemo: true, acceptedFreight: true, locations: { select: { type: true, city: true } } } } },
    orderBy: { issuedAt: 'desc' },
  });
  const payments = await prisma.payment.groupBy({ by: ['bookingId', 'status'], where: { companyId }, _sum: { amount: true } });
  const sumFor = (bookingId: string, status: string) => payments.find((r) => r.bookingId === bookingId && r.status === status)?._sum.amount ?? ZERO;
  const refunds = payments.filter((r) => r.status === 'REFUNDED').reduce((s, r) => s.plus(r._sum.amount ?? ZERO), ZERO);
  const refundPending = payments.filter((r) => r.status === 'REFUND_PENDING').reduce((s, r) => s.plus(r._sum.amount ?? ZERO), ZERO);

  const byBooking = new Map<string, { inv: (typeof invoices)[number]; total: Prisma.Decimal; freight: Prisma.Decimal; numbers: string[] }>();
  for (const inv of invoices) {
    const e = byBooking.get(inv.bookingId) ?? { inv, total: ZERO, freight: ZERO, numbers: [] };
    e.total = e.total.plus(inv.totalAmount);
    e.freight = e.freight.plus(inv.freightAmount);
    e.numbers.push(inv.invoiceNumber);
    byBooking.set(inv.bookingId, e);
  }
  let totalInvoiced = ZERO;
  let totalFreight = ZERO;
  let totalPaid = ZERO;
  const outstanding = [];
  for (const [bookingId, e] of byBooking) {
    const paid = sumFor(bookingId, 'PAID');
    totalInvoiced = totalInvoiced.plus(e.total);
    totalFreight = totalFreight.plus(e.freight);
    totalPaid = totalPaid.plus(paid);
    const due = e.total.minus(paid);
    if (due.greaterThan(0) && e.inv.booking.status !== 'CANCELLED') {
      outstanding.push({
        bookingId,
        bookingCode: e.inv.booking.bookingCode,
        isDemo: e.inv.booking.isDemo,
        route: `${e.inv.booking.locations.find((l) => l.type === 'PICKUP')?.city ?? '-'} → ${e.inv.booking.locations.find((l) => l.type === 'DELIVERY')?.city ?? '-'}`,
        invoiceNumber: e.numbers.join(', '),
        total: e.total,
        paid,
        due,
        paymentStatus: e.inv.booking.paymentStatus,
        dueAt: e.inv.dueAt,
      });
    }
  }
  return {
    provider: activePaymentProvider(),
    totals: {
      freight: totalFreight,
      invoiced: totalInvoiced,
      paid: totalPaid,
      outstanding: Prisma.Decimal.max(ZERO, totalInvoiced.minus(totalPaid)),
      refunded: refunds,
      refundPending,
    },
    outstanding,
  };
}
