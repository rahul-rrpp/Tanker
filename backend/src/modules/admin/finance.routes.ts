import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { notifyTransporter } from '../notifications/notification.service';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { nextCode } from '../../lib/codes';
import { round2 } from '../../lib/money';
import { prisma } from '../../lib/prisma';
import { AppError, ErrorCode } from '../../utils/errors';
import { created, ok } from '../../utils/response';
import { audit } from '../audit/audit';
import { notify } from '../notifications/notification.service';
import { fetchGatewayPayment } from '../payments/payment.gateway';
import { nextCodeRaw } from './codes';
import { computeCommission, ensureCommissions } from './commission.service';
import { adminAuth, body, can, dateRange, idOf, insensitive, orderBy, parseList, respondList, win, type Column } from './core';

const dec = (v: Prisma.Decimal | null | undefined) => (v ? v.toNumber() : 0);

async function recomputePaymentStatus(tx: Prisma.TransactionClient, bookingId: string) {
  const invoices = await tx.invoice.findMany({ where: { bookingId, status: { not: 'CANCELLED' } }, orderBy: { issuedAt: 'asc' } });
  const total = invoices.reduce((s, i) => s.plus(i.totalAmount), new Prisma.Decimal(0));
  const rows = await tx.payment.findMany({ where: { bookingId } });
  const paid = rows.filter((p) => p.status === 'PAID').reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));
  const refundPending = rows.some((p) => p.status === 'REFUND_PENDING');
  const refunded = rows.some((p) => p.status === 'REFUNDED') && paid.isZero();
  const status = refundPending ? 'REFUND_PENDING' : refunded ? 'REFUNDED' : total.greaterThan(0) && paid.greaterThanOrEqualTo(total) ? 'PAID' : paid.greaterThan(0) ? 'PARTIALLY_PAID' : 'PENDING';
  await tx.booking.update({ where: { id: bookingId }, data: { paymentStatus: status } });
  let left = paid;
  for (const inv of invoices) {
    await tx.invoice.update({ where: { id: inv.id }, data: { status: left.greaterThanOrEqualTo(inv.totalAmount) ? 'PAID' : left.greaterThan(0) ? 'PARTIALLY_PAID' : 'ISSUED' } });
    left = Prisma.Decimal.max(0, left.minus(inv.totalAmount));
  }
}

// ===========================================================================
// Payments
// ===========================================================================

export const adminPaymentsRouter = Router();
adminPaymentsRouter.use(...adminAuth);

adminPaymentsRouter.get('/summary', can('payments', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req);
  const range = dateRange(q);
  await ensureCommissions();
  const [booked, invoiced, collected, refunds, refundsPending, commission, settled, pending, failed] = await Promise.all([
    prisma.booking.aggregate({ where: { acceptedFreight: { not: null }, status: { not: 'CANCELLED' }, ...(range ? { confirmedAt: range } : {}) }, _sum: { acceptedFreight: true } }),
    prisma.invoice.aggregate({ where: { status: { not: 'CANCELLED' }, ...(range ? { issuedAt: range } : {}) }, _sum: { totalAmount: true } }),
    prisma.payment.aggregate({ where: { status: 'PAID', ...(range ? { paidAt: range } : {}) }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { status: 'REFUNDED', ...(range ? { updatedAt: range } : {}) }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { status: 'REFUND_PENDING' }, _sum: { amount: true } }),
    prisma.bookingCommission.aggregate({ where: range ? { computedAt: range } : {}, _sum: { commissionAmount: true, transporterPayable: true } }),
    prisma.settlement.aggregate({ where: { status: 'SETTLED', ...(range ? { settledAt: range } : {}) }, _sum: { amount: true } }),
    prisma.settlement.aggregate({ where: { status: { in: ['PENDING', 'ON_HOLD'] } }, _sum: { amount: true } }),
    prisma.payment.count({ where: { status: 'FAILED', ...(range ? { createdAt: range } : {}) } }),
  ]);
  ok(res, 'Payment dashboard', {
    totalBookingValue: dec(booked._sum.acceptedFreight),
    totalInvoiced: dec(invoiced._sum.totalAmount),
    totalCollected: dec(collected._sum.amount),
    pendingCollection: Math.max(0, dec(invoiced._sum.totalAmount) - dec(collected._sum.amount)),
    refunds: dec(refunds._sum.amount),
    refundsPending: dec(refundsPending._sum.amount),
    platformCommission: dec(commission._sum.commissionAmount),
    transporterPayable: dec(commission._sum.transporterPayable),
    settledAmount: dec(settled._sum.amount),
    pendingSettlements: dec(pending._sum.amount),
    failedPayments: failed,
    gateway: { provider: env.PAYMENT_PROVIDER, keyConfigured: Boolean(env.RAZORPAY_KEY_ID), webhookConfigured: Boolean(env.RAZORPAY_WEBHOOK_SECRET) },
  });
});

const paymentColumns: Column[] = [
  { key: 'paymentRef', label: 'Payment ID', format: 'text' },
  { key: 'bookingCode', label: 'Booking ID', format: 'text' },
  { key: 'company', label: 'Company', format: 'text' },
  { key: 'transporter', label: 'Transporter', format: 'text' },
  { key: 'amount', label: 'Amount', format: 'currency' },
  { key: 'method', label: 'Method', format: 'text' },
  { key: 'status', label: 'Status', format: 'text' },
  { key: 'reference', label: 'Transaction reference', format: 'text' },
  { key: 'date', label: 'Payment date', format: 'datetime' },
];

adminPaymentsRouter.get('/', can('payments', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { status: z.enum(['CREATED', 'PAID', 'FAILED', 'REFUND_PENDING', 'REFUNDED']).optional(), provider: z.string().optional(), companyId: z.string().uuid().optional(), method: z.string().optional() });
  const where: Prisma.PaymentWhereInput = {
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.provider ? { provider: q.provider as never } : {}),
    ...(q.method ? { method: q.method as never } : {}),
    ...(q.companyId ? { companyId: q.companyId as string } : {}),
    ...(q.from || q.to ? { createdAt: dateRange(q) } : {}),
    ...(q.q ? { OR: [{ providerOrderId: insensitive(q.q) }, { providerPaymentId: insensitive(q.q) }, { receiptNumber: insensitive(q.q) }, { booking: { bookingCode: insensitive(q.q) } }, { company: { name: insensitive(q.q) } }] } : {}),
  };
  const load = async (paged: boolean) => {
    const rows = await prisma.payment.findMany({
      where,
      orderBy: orderBy(q, ['createdAt', 'amount', 'paidAt', 'status'], 'createdAt'),
      ...win(q, paged),
      include: { booking: { select: { id: true, bookingCode: true, allocations: { select: { transporter: { select: { companyName: true } } } } } }, company: { select: { name: true } } },
    });
    return rows.map((p) => ({
      id: p.id,
      paymentRef: p.receiptNumber ?? p.id.slice(0, 8).toUpperCase(),
      bookingId: p.booking.id,
      bookingCode: p.booking.bookingCode,
      company: p.company.name,
      transporter: [...new Set(p.booking.allocations.map((a) => a.transporter.companyName))].join(', ') || null,
      amount: p.amount.toNumber(),
      method: p.method,
      status: p.status,
      provider: p.provider,
      purpose: p.purpose,
      reference: p.providerPaymentId ?? p.providerOrderId,
      date: p.paidAt ?? p.createdAt,
      failureReason: p.failureReason,
    }));
  };
  const [total, rows] = await Promise.all([prisma.payment.count({ where }), load(true)]);
  await respondList(req, res, { title: 'Payments', q, columns: paymentColumns, total, rows, exportRows: () => load(false), module: 'payments' });
});

adminPaymentsRouter.get('/:id', can('payments', 'view'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const p = await prisma.payment.findUnique({ where: { id }, include: { booking: { select: { id: true, bookingCode: true, paymentStatus: true } }, company: { select: { id: true, name: true } } } });
  if (!p) throw AppError.notFound('Payment not found');
  const [recon, refunds] = await Promise.all([prisma.reconciliationLog.findMany({ where: { paymentId: id }, orderBy: { createdAt: 'desc' } }), prisma.refundRequest.findMany({ where: { paymentId: id }, orderBy: { createdAt: 'desc' } })]);
  // gatewayPayload is the stored gateway response (no secrets are ever stored in it).
  ok(res, 'Payment', { payment: p, reconciliation: recon, refunds });
});

/** Re-checks the payment with the gateway (source of truth) and logs the result; never edits a PAID record. */
adminPaymentsRouter.post('/:id/reconcile', can('payments', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const p = await prisma.payment.findUnique({ where: { id } });
  if (!p) throw AppError.notFound('Payment not found');
  let result: 'MATCHED' | 'MISMATCH' | 'NOT_FOUND' = 'NOT_FOUND';
  let gatewayStatus: string | null = null;
  let details: Prisma.InputJsonValue = {};
  if (p.provider === 'OFFLINE') {
    result = p.status === 'PAID' ? 'MATCHED' : 'MISMATCH';
    gatewayStatus = 'OFFLINE';
    details = { note: 'Offline payment: match against the bank statement reference', reference: p.providerPaymentId };
  } else if (p.providerPaymentId) {
    try {
      const mock = p.provider === 'MOCK' ? ((p.gatewayPayload as Record<string, unknown> | null)?.mockGateway as Record<string, never> | undefined) ?? { paymentId: p.providerPaymentId, orderId: p.providerOrderId, amountPaise: Math.round(p.amount.toNumber() * 100), status: p.status === 'PAID' ? 'captured' : 'failed' } : null;
      const gw = await fetchGatewayPayment(p.provider, p.providerPaymentId, mock);
      gatewayStatus = gw.status;
      const amountOk = gw.amountPaise === Math.round(p.amount.toNumber() * 100);
      const statusOk = (gw.status === 'captured') === (p.status === 'PAID' || p.status === 'REFUND_PENDING' || p.status === 'REFUNDED');
      result = amountOk && statusOk && gw.orderId === p.providerOrderId ? 'MATCHED' : 'MISMATCH';
      details = { gatewayAmountPaise: gw.amountPaise, gatewayOrderId: gw.orderId, amountOk, statusOk };
    } catch (e) {
      details = { error: (e as Error).message };
    }
  } else {
    details = { note: 'No gateway payment id yet (order created, checkout not completed)' };
  }
  const log = await prisma.reconciliationLog.create({ data: { paymentId: id, result, gatewayStatus, details, performedById: req.admin!.userId } });
  await audit({ action: 'payment.reconciled', entityType: 'payment', entityId: id, companyId: p.companyId, module: 'payments', newValue: { result, gatewayStatus }, req });
  ok(res, `Reconciliation: ${result}`, { log });
});

/** Authorised offline payment (NEFT/RTGS/cheque). Immutable once recorded. */
adminPaymentsRouter.post('/offline', can('payments', 'create'), async (req: Request, res: Response) => {
  const input = body(req, z.object({ bookingId: z.string().uuid(), amount: z.number().positive().max(100_000_000), purpose: z.enum(['ADVANCE', 'BALANCE', 'FULL']), reference: z.string().trim().min(4).max(60), paidOn: z.coerce.date(), note: z.string().trim().max(300).optional() }));
  const b = await prisma.booking.findUnique({ where: { id: input.bookingId }, select: { id: true, companyId: true, bookingCode: true, status: true } });
  if (!b) throw AppError.notFound('Booking not found');
  if (await prisma.payment.findFirst({ where: { provider: 'OFFLINE', providerPaymentId: input.reference } })) throw AppError.conflict('A payment with this transaction reference already exists (duplicate prevented)');
  const invoiced = await prisma.invoice.aggregate({ where: { bookingId: b.id, status: { not: 'CANCELLED' } }, _sum: { totalAmount: true } });
  const paid = await prisma.payment.aggregate({ where: { bookingId: b.id, status: 'PAID' }, _sum: { amount: true } });
  if (dec(paid._sum.amount) + input.amount > dec(invoiced._sum.totalAmount) + 0.01) throw AppError.badRequest('Amount exceeds the outstanding balance on this booking');
  const p = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: {
        bookingId: b.id,
        companyId: b.companyId,
        purpose: input.purpose,
        amount: input.amount,
        status: 'PAID',
        provider: 'OFFLINE',
        providerOrderId: `offline_${randomBytes(8).toString('hex')}`,
        providerPaymentId: input.reference,
        method: 'NETBANKING',
        signatureVerified: false,
        paidAt: input.paidOn,
        receiptNumber: await nextCode(tx, 'receipt'),
        gatewayPayload: { offline: true, recordedBy: req.admin!.userId, note: input.note ?? null },
        createdById: req.admin!.userId,
      },
    });
    await recomputePaymentStatus(tx, b.id);
    await audit({ action: 'payment.offline_recorded', entityType: 'payment', entityId: p.id, companyId: b.companyId, module: 'payments', newValue: { amount: input.amount, reference: input.reference }, req }, tx);
    return p;
  });
  await notify({ companyId: b.companyId, type: 'PAYMENT_RECEIVED', title: `Payment received for ${b.bookingCode}`, message: `Rs ${input.amount.toLocaleString('en-IN')} recorded (ref ${input.reference}). Receipt ${p.receiptNumber}.`, bookingId: b.id });
  created(res, 'Offline payment recorded', { payment: p });
});

adminPaymentsRouter.get('/refunds/list', can('payments', 'view'), async (_req: Request, res: Response) => {
  const items = await prisma.refundRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  const pays = new Map((await prisma.payment.findMany({ where: { id: { in: items.map((i) => i.paymentId) } }, select: { id: true, amount: true, receiptNumber: true, booking: { select: { bookingCode: true } }, company: { select: { name: true } } } })).map((p) => [p.id, p]));
  ok(res, 'Refund requests', { items: items.map((i) => ({ ...i, payment: pays.get(i.paymentId) ?? null })) });
});

adminPaymentsRouter.post('/:id/refunds', can('payments', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const input = body(req, z.object({ amount: z.number().positive(), reason: z.string().trim().min(10).max(500) }));
  const p = await prisma.payment.findUnique({ where: { id } });
  if (!p || !['PAID', 'REFUND_PENDING'].includes(p.status)) throw AppError.badRequest('Only collected payments can be refunded');
  const already = await prisma.refundRequest.aggregate({ where: { paymentId: id, status: { in: ['REQUESTED', 'APPROVED', 'PROCESSED'] } }, _sum: { amount: true } });
  if (dec(already._sum.amount) + input.amount > p.amount.toNumber() + 0.001) throw AppError.badRequest('Refund exceeds the payment amount');
  const r = await prisma.refundRequest.create({ data: { paymentId: id, amount: input.amount, reason: input.reason, requestedById: req.admin!.userId } });
  await audit({ action: 'refund.requested', entityType: 'refund_request', entityId: r.id, companyId: p.companyId, module: 'payments', newValue: { paymentId: id, amount: input.amount }, req });
  created(res, 'Refund requested; it needs approval', { refund: r });
});

/** Refund approval (payments.approve, not the requester) and processing. Payment rows move status only. */
adminPaymentsRouter.post('/refunds/:id/review', can('payments', 'approve'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const { decision, note } = body(req, z.object({ decision: z.enum(['APPROVE', 'REJECT', 'MARK_PROCESSED']), note: z.string().trim().min(3).max(500) }));
  const r = await prisma.refundRequest.findUnique({ where: { id } });
  if (!r) throw AppError.notFound('Refund request not found');
  if (decision !== 'MARK_PROCESSED' && r.status !== 'REQUESTED') throw AppError.conflict('Already reviewed');
  if (decision === 'MARK_PROCESSED' && r.status !== 'APPROVED') throw AppError.conflict('Approve the refund first');
  if (decision === 'APPROVE' && r.requestedById === req.admin!.userId) throw AppError.forbidden('Refunds must be approved by someone other than the requester');
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: r.paymentId } });
  await prisma.$transaction(async (tx) => {
    const status = decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'PROCESSED';
    await tx.refundRequest.update({ where: { id }, data: { status, approvedById: decision === 'MARK_PROCESSED' ? r.approvedById : req.admin!.userId, reviewNote: note, processedAt: decision === 'MARK_PROCESSED' ? new Date() : null } });
    if (decision === 'APPROVE') await tx.payment.update({ where: { id: p.id }, data: { status: 'REFUND_PENDING' } });
    if (decision === 'MARK_PROCESSED' && r.amount.equals(p.amount)) await tx.payment.update({ where: { id: p.id }, data: { status: 'REFUNDED' } });
    await recomputePaymentStatus(tx, p.bookingId);
    await audit({ action: `refund.${status.toLowerCase()}`, entityType: 'refund_request', entityId: id, companyId: p.companyId, module: 'payments', newValue: { amount: r.amount.toNumber(), note }, req }, tx);
  });
  ok(res, 'Refund updated', null);
});

// ===========================================================================
// Commission rules (versioned), booking commissions, settlements
// ===========================================================================

export const adminCommissionsRouter = Router();
adminCommissionsRouter.use(...adminAuth);

const ruleSchema = z.object({
  name: z.string().trim().min(3).max(120),
  calcType: z.enum(['PERCENT', 'FIXED']),
  value: z.number().min(0).max(1_000_000),
  companyCategory: z.string().trim().max(40).nullable().optional(),
  transporterCategory: z.string().trim().max(40).nullable().optional(),
  originState: z.string().trim().max(80).nullable().optional(),
  destState: z.string().trim().max(80).nullable().optional(),
  bookingType: z.enum(['PORTAL', 'ADMIN_ASSISTED']).nullable().optional(),
  promoCode: z.string().trim().max(30).nullable().optional(),
  priority: z.number().int().min(0).max(100).default(0),
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().nullable().optional(),
  isActive: z.boolean().default(true),
}).refine((r) => r.calcType !== 'PERCENT' || r.value <= 100, { message: 'Percentage cannot exceed 100', path: ['value'] })
  .refine((r) => !r.effectiveTo || r.effectiveTo > r.effectiveFrom, { message: 'End must be after start', path: ['effectiveTo'] });

adminCommissionsRouter.get('/rules', can('commissions', 'view'), async (req: Request, res: Response) => {
  const history = req.query.history === 'true';
  const rules = await prisma.commissionRule.findMany({ where: history ? {} : { supersededAt: null }, orderBy: [{ ruleCode: 'asc' }, { version: 'desc' }], include: { _count: { select: { commissions: true } } } });
  ok(res, 'Commission rules', { rules });
});

adminCommissionsRouter.post('/rules', can('commissions', 'create'), async (req: Request, res: Response) => {
  const input = body(req, ruleSchema);
  const count = await prisma.commissionRule.count({ where: { version: 1 } });
  const r = await prisma.$transaction(async (tx) => {
    const r = await tx.commissionRule.create({ data: { ...input, ruleCode: `CR-${String(count + 1).padStart(4, '0')}`, createdById: req.admin!.userId } });
    await audit({ action: 'commission.rule_created', entityType: 'commission_rule', entityId: r.id, module: 'commissions', newValue: input as unknown as Prisma.InputJsonValue, req }, tx);
    return r;
  });
  created(res, 'Commission rule created', { rule: r });
});

/** Editing creates a new version (old one superseded, kept for history and past bookings). */
adminCommissionsRouter.put('/rules/:id', can('commissions', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const input = body(req, ruleSchema);
  const old = await prisma.commissionRule.findUnique({ where: { id } });
  if (!old || old.supersededAt) throw AppError.notFound('Current rule version not found');
  const r = await prisma.$transaction(async (tx) => {
    await tx.commissionRule.update({ where: { id }, data: { supersededAt: new Date(), isActive: false } });
    const r = await tx.commissionRule.create({ data: { ...input, ruleCode: old.ruleCode, version: old.version + 1, createdById: req.admin!.userId } });
    await audit({ action: 'commission.rule_changed', entityType: 'commission_rule', entityId: r.id, module: 'commissions', previousValue: { version: old.version, calcType: old.calcType, value: old.value.toNumber(), isActive: old.isActive }, newValue: { version: r.version, ...input } as unknown as Prisma.InputJsonValue, req }, tx);
    return r;
  });
  ok(res, `Rule updated (version ${r.version})`, { rule: r });
});

adminCommissionsRouter.post('/rules/:id/toggle', can('commissions', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const r = await prisma.commissionRule.findUnique({ where: { id } });
  if (!r || r.supersededAt) throw AppError.notFound('Rule not found');
  await prisma.commissionRule.update({ where: { id }, data: { isActive: !r.isActive } });
  await audit({ action: r.isActive ? 'commission.rule_deactivated' : 'commission.rule_activated', entityType: 'commission_rule', entityId: id, module: 'commissions', previousValue: { isActive: r.isActive }, newValue: { isActive: !r.isActive }, req });
  ok(res, r.isActive ? 'Rule deactivated' : 'Rule activated', null);
});

/** Calculator: shows what the engine would charge, without saving anything. */
adminCommissionsRouter.post('/preview', can('commissions', 'view'), async (req: Request, res: Response) => {
  const { freight, ruleId } = body(req, z.object({ freight: z.number().positive(), ruleId: z.string().uuid() }));
  const rule = await prisma.commissionRule.findUnique({ where: { id: ruleId } });
  if (!rule) throw AppError.notFound('Rule not found');
  const c = computeCommission(rule, new Prisma.Decimal(freight));
  ok(res, 'Preview', { freight, commission: c.commission.toNumber(), transporterPayable: c.payable.toNumber() });
});

const commissionColumns: Column[] = [
  { key: 'bookingCode', label: 'Booking ID', format: 'text' },
  { key: 'transporter', label: 'Transporter', format: 'text' },
  { key: 'rule', label: 'Rule', format: 'text' },
  { key: 'freight', label: 'Freight', format: 'currency' },
  { key: 'commission', label: 'Commission', format: 'currency' },
  { key: 'payable', label: 'Transporter payable', format: 'currency' },
  { key: 'settlementStatus', label: 'Settlement', format: 'text' },
  { key: 'computedAt', label: 'Date', format: 'datetime' },
];

adminCommissionsRouter.get('/bookings', can('commissions', 'view'), async (req: Request, res: Response) => {
  await ensureCommissions();
  const q = parseList(req, { transporterId: z.string().uuid().optional() });
  const where: Prisma.BookingCommissionWhereInput = { ...(q.transporterId ? { transporterId: q.transporterId as string } : {}), ...(q.from || q.to ? { computedAt: dateRange(q) } : {}) };
  const load = async (paged: boolean) => {
    const rows = await prisma.bookingCommission.findMany({ where, orderBy: orderBy(q, ['computedAt', 'commissionAmount', 'freightAmount'], 'computedAt'), ...win(q, paged), include: { rule: { select: { name: true, version: true } } } });
    const [bookings, transporters, settlements] = await Promise.all([
      prisma.booking.findMany({ where: { id: { in: rows.map((r) => r.bookingId) } }, select: { id: true, bookingCode: true } }),
      prisma.agency.findMany({ where: { id: { in: rows.map((r) => r.transporterId) } }, select: { id: true, companyName: true } }),
      prisma.settlement.findMany({ where: { allocationId: { in: rows.map((r) => r.allocationId) } }, select: { allocationId: true, status: true } }),
    ]);
    const bm = new Map(bookings.map((b) => [b.id, b.bookingCode]));
    const tm = new Map(transporters.map((t) => [t.id, t.companyName]));
    const sm = new Map(settlements.map((s) => [s.allocationId, s.status]));
    return rows
      .map((r) => ({ id: r.id, bookingId: r.bookingId, bookingCode: bm.get(r.bookingId), transporter: tm.get(r.transporterId), rule: r.rule ? `${r.rule.name} v${r.rule.version}` : 'No rule (0%)', freight: r.freightAmount.toNumber(), commission: r.commissionAmount.toNumber(), payable: r.transporterPayable.toNumber(), settlementStatus: sm.get(r.allocationId) ?? null, computedAt: r.computedAt }))
      .filter((r) => !q.q || `${r.bookingCode} ${r.transporter}`.toLowerCase().includes(q.q.toLowerCase()));
  };
  const [total, rows] = await Promise.all([prisma.bookingCommission.count({ where }), load(true)]);
  await respondList(req, res, { title: 'Booking commissions', q, columns: commissionColumns, total, rows, exportRows: () => load(false), module: 'commissions' });
});

adminCommissionsRouter.get('/summary', can('commissions', 'view'), async (_req: Request, res: Response) => {
  await ensureCommissions();
  const byTransporter = await prisma.bookingCommission.groupBy({ by: ['transporterId'], _sum: { commissionAmount: true, transporterPayable: true, freightAmount: true }, _count: { _all: true } });
  const names = new Map((await prisma.agency.findMany({ where: { id: { in: byTransporter.map((b) => b.transporterId) } }, select: { id: true, companyName: true } })).map((t) => [t.id, t.companyName]));
  const monthly = await prisma.$queryRaw<{ k: string; c: Prisma.Decimal; f: Prisma.Decimal; n: bigint }[]>`
    SELECT to_char(date_trunc('month', ("computedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') k, SUM("commissionAmount") c, SUM("freightAmount") f, COUNT(*) n
      FROM booking_commissions GROUP BY 1 ORDER BY 1 DESC LIMIT 12`;
  ok(res, 'Commission summary', {
    transporters: byTransporter.map((b) => ({ transporterId: b.transporterId, transporter: names.get(b.transporterId), allocations: b._count._all, freight: dec(b._sum.freightAmount), commission: dec(b._sum.commissionAmount), payable: dec(b._sum.transporterPayable) })).sort((a, b) => b.commission - a.commission),
    monthly: monthly.map((m) => ({ month: m.k, commission: dec(m.c), freight: dec(m.f), allocations: Number(m.n) })).reverse(),
  });
});

adminCommissionsRouter.get('/settlements', can('commissions', 'view'), async (req: Request, res: Response) => {
  await ensureCommissions();
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const items = await prisma.settlement.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 300, include: { transporter: { select: { companyName: true } } } });
  ok(res, 'Settlements', { items });
});

/** Marks a transporter settlement as paid out (bank reference required). Settlement payouts themselves happen outside the platform in Phase 1. */
adminCommissionsRouter.post('/settlements/:id/settle', can('commissions', 'approve'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const { reference } = body(req, z.object({ reference: z.string().trim().min(4).max(80) }));
  const s = await prisma.settlement.findUnique({ where: { id } });
  if (!s) throw AppError.notFound('Settlement not found');
  if (s.status !== 'PENDING') throw AppError.conflict(s.status === 'ON_HOLD' ? 'Settlement is on hold until the trip completes' : 'Already settled', ErrorCode.INVALID_STATE_TRANSITION);
  await prisma.$transaction(async (tx) => {
    await tx.settlement.update({ where: { id }, data: { status: 'SETTLED', reference, settledAt: new Date(), approvedById: req.admin!.userId } });
    await audit({ action: 'settlement.settled', entityType: 'settlement', entityId: id, module: 'commissions', previousValue: { status: s.status }, newValue: { status: 'SETTLED', reference, amount: s.amount.toNumber() }, req }, tx);
  });
  await notifyTransporter(s.transporterId, { type: 'SETTLEMENT_PROCESSED', title: `Settlement ${s.settlementCode} paid`, message: `Rs ${s.amount.toNumber().toLocaleString('en-IN')} has been settled. Bank reference: ${reference}.`, link: '/transporter/settlements' });
  ok(res, 'Settlement marked as paid', null);
});

// ===========================================================================
// Subscriptions
// ===========================================================================

export const adminSubscriptionsRouter = Router();
adminSubscriptionsRouter.use(...adminAuth);

const planSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{3,30}$/),
  name: z.string().trim().min(2).max(80),
  userCategory: z.enum(['COMPANY', 'TRANSPORTER']),
  price: z.number().min(0).max(10_000_000),
  validityDays: z.number().int().min(1).max(3650),
  features: z.array(z.string().trim().min(2).max(120)).max(20),
  bookingLimit: z.number().int().min(1).nullable().optional(),
  priorityLevel: z.number().int().min(0).max(10),
  isActive: z.boolean().default(true),
});

adminSubscriptionsRouter.get('/plans', can('subscriptions', 'view'), async (_req: Request, res: Response) => {
  const plans = await prisma.subscriptionPlan.findMany({ orderBy: [{ userCategory: 'asc' }, { price: 'asc' }], include: { _count: { select: { subscriptions: true } } } });
  ok(res, 'Plans', { plans, disclaimer: 'Paid plans never guarantee bookings or business volume.' });
});

adminSubscriptionsRouter.post('/plans', can('subscriptions', 'create'), async (req: Request, res: Response) => {
  const input = body(req, planSchema);
  if (await prisma.subscriptionPlan.findUnique({ where: { code: input.code } })) throw AppError.conflict('A plan with this code exists');
  const p = await prisma.subscriptionPlan.create({ data: input });
  await audit({ action: 'subscription.plan_created', entityType: 'subscription_plan', entityId: p.id, module: 'subscriptions', newValue: input as unknown as Prisma.InputJsonValue, req });
  created(res, 'Plan created', { plan: p });
});

adminSubscriptionsRouter.put('/plans/:id', can('subscriptions', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const input = body(req, planSchema.omit({ code: true }));
  const before = await prisma.subscriptionPlan.findUnique({ where: { id } });
  if (!before) throw AppError.notFound('Plan not found');
  const p = await prisma.subscriptionPlan.update({ where: { id }, data: input });
  await audit({ action: 'subscription.plan_updated', entityType: 'subscription_plan', entityId: id, module: 'subscriptions', previousValue: { price: before.price.toNumber(), isActive: before.isActive }, newValue: input as unknown as Prisma.InputJsonValue, req });
  ok(res, 'Plan updated (existing subscriptions keep their purchase price)', { plan: p });
});

adminSubscriptionsRouter.get('/', can('subscriptions', 'view'), async (req: Request, res: Response) => {
  // Expire lapsed subscriptions first so the list is accurate.
  await prisma.subscription.updateMany({ where: { status: 'ACTIVE', endAt: { lt: new Date() } }, data: { status: 'EXPIRED' } });
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const items = await prisma.subscription.findMany({ where: status ? { status } : {}, orderBy: { startAt: 'desc' }, take: 300, include: { plan: { select: { name: true, userCategory: true } } } });
  const companies = new Map((await prisma.company.findMany({ where: { id: { in: items.map((i) => i.companyId!).filter(Boolean) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const transporters = new Map((await prisma.agency.findMany({ where: { id: { in: items.map((i) => i.transporterId!).filter(Boolean) } }, select: { id: true, companyName: true } })).map((t) => [t.id, t.companyName]));
  const revenue = await prisma.subscription.aggregate({ where: { status: { not: 'CANCELLED' } }, _sum: { amount: true } });
  ok(res, 'Subscriptions', {
    items: items.map((s) => ({ ...s, subscriber: s.companyId ? companies.get(s.companyId) : s.transporterId ? transporters.get(s.transporterId) : null })),
    revenue: dec(revenue._sum.amount),
    upForRenewal: items.filter((s) => s.status === 'ACTIVE' && s.endAt.getTime() - Date.now() < 15 * 86400_000).length,
  });
});

adminSubscriptionsRouter.post('/', can('subscriptions', 'assign'), async (req: Request, res: Response) => {
  const input = body(req, z.object({ planId: z.string().uuid(), subscriberId: z.string().uuid(), startAt: z.coerce.date().optional(), autoRenew: z.boolean().default(false), renewOf: z.string().uuid().optional() }));
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: input.planId } });
  if (!plan || !plan.isActive) throw AppError.badRequest('Select an active plan');
  const isCompany = plan.userCategory === 'COMPANY';
  const exists = isCompany ? await prisma.company.findUnique({ where: { id: input.subscriberId } }) : await prisma.agency.findUnique({ where: { id: input.subscriberId } });
  if (!exists) throw AppError.badRequest(`Select a ${isCompany ? 'company' : 'transporter'}`);
  const activeSame = await prisma.subscription.findFirst({ where: { status: 'ACTIVE', ...(isCompany ? { companyId: input.subscriberId } : { transporterId: input.subscriberId }), endAt: { gt: new Date() } } });
  const startAt = input.startAt ?? (input.renewOf && activeSame ? activeSame.endAt : new Date());
  if (activeSame && !input.renewOf && startAt < activeSame.endAt) throw AppError.conflict('This subscriber already has an active plan; renew it instead');
  const s = await prisma.$transaction(async (tx) => {
    const s = await tx.subscription.create({
      data: {
        subscriptionCode: await nextCodeRaw(tx, 'subscription_code_seq', 'SUB', 6),
        planId: plan.id,
        subscriberType: plan.userCategory,
        companyId: isCompany ? input.subscriberId : null,
        transporterId: isCompany ? null : input.subscriberId,
        startAt,
        endAt: new Date(startAt.getTime() + plan.validityDays * 86400_000),
        amount: plan.price,
        autoRenew: input.autoRenew,
        renewedFromId: input.renewOf ?? null,
        createdById: req.admin!.userId,
      },
    });
    await audit({ action: input.renewOf ? 'subscription.renewed' : 'subscription.assigned', entityType: 'subscription', entityId: s.id, module: 'subscriptions', newValue: { plan: plan.code, subscriberId: input.subscriberId, amount: plan.price.toNumber() }, req }, tx);
    return s;
  });
  created(res, input.renewOf ? 'Subscription renewed' : 'Plan assigned', { subscription: s });
});

adminSubscriptionsRouter.post('/:id/cancel', can('subscriptions', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const { reason } = body(req, z.object({ reason: z.string().trim().min(3).max(300) }));
  const s = await prisma.subscription.findUnique({ where: { id } });
  if (!s || s.status !== 'ACTIVE') throw AppError.notFound('Active subscription not found');
  await prisma.subscription.update({ where: { id }, data: { status: 'CANCELLED' } });
  await audit({ action: 'subscription.cancelled', entityType: 'subscription', entityId: id, module: 'subscriptions', newValue: { reason }, req });
  ok(res, 'Subscription cancelled', null);
});

// ===========================================================================
// Services & products (managed internally; no service-provider login)
// ===========================================================================

export const adminServicesRouter = Router();
adminServicesRouter.use(...adminAuth);

export const SERVICE_CATEGORIES = ['GPS_TRACKING_DEVICES', 'GPS_SUBSCRIPTIONS', 'VEHICLE_INSURANCE', 'DRIVER_RECRUITMENT', 'DRIVER_TRAINING', 'TYRES', 'BATTERIES', 'VEHICLE_MAINTENANCE', 'FLEET_SOFTWARE', 'PREMIUM_LISTING', 'ADVERTISING', 'LOGISTICS_CONSULTANCY'] as const;

const serviceSchema = z.object({
  name: z.string().trim().min(3).max(120),
  category: z.enum(SERVICE_CATEGORIES),
  description: z.string().trim().max(1000).optional(),
  sellingPrice: z.number().min(0).max(10_000_000),
  costPrice: z.number().min(0).max(10_000_000),
  taxRate: z.number().min(0).max(28),
  availability: z.enum(['AVAILABLE', 'LIMITED', 'UNAVAILABLE']),
  requiresLicensedPartner: z.boolean().default(false),
  partnerName: z.string().trim().max(120).optional(),
  isActive: z.boolean().default(true),
}).refine((s) => s.category !== 'VEHICLE_INSURANCE' || s.requiresLicensedPartner, { message: 'Insurance must be fulfilled through a licensed partner', path: ['requiresLicensedPartner'] });

adminServicesRouter.get('/', can('services', 'view'), async (_req: Request, res: Response) => {
  const services = await prisma.service.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }], include: { _count: { select: { orders: true } } } });
  ok(res, 'Services', { services: services.map((s) => ({ ...s, marginPercent: s.sellingPrice.isZero() ? 0 : Math.round(((s.sellingPrice.toNumber() - s.costPrice.toNumber()) / s.sellingPrice.toNumber()) * 1000) / 10 })), categories: SERVICE_CATEGORIES });
});

adminServicesRouter.post('/', can('services', 'create'), async (req: Request, res: Response) => {
  const input = body(req, serviceSchema);
  const s = await prisma.$transaction(async (tx) => {
    const s = await tx.service.create({ data: { ...input, serviceCode: await nextCodeRaw(tx, 'service_code_seq', 'SRV', 4) } });
    await audit({ action: 'service.created', entityType: 'service', entityId: s.id, module: 'services', newValue: input as unknown as Prisma.InputJsonValue, req }, tx);
    return s;
  });
  created(res, 'Service created', { service: s });
});

adminServicesRouter.put('/:id', can('services', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const input = body(req, serviceSchema);
  const before = await prisma.service.findUnique({ where: { id } });
  if (!before) throw AppError.notFound('Service not found');
  const s = await prisma.service.update({ where: { id }, data: input });
  await audit({ action: 'service.updated', entityType: 'service', entityId: id, module: 'services', previousValue: { sellingPrice: before.sellingPrice.toNumber(), isActive: before.isActive }, newValue: input as unknown as Prisma.InputJsonValue, req });
  ok(res, 'Service updated', { service: s });
});

adminServicesRouter.get('/orders', can('services', 'view'), async (_req: Request, res: Response) => {
  const orders = await prisma.serviceOrder.findMany({ orderBy: { createdAt: 'desc' }, take: 300, include: { service: { select: { name: true, category: true } } } });
  const companies = new Map((await prisma.company.findMany({ where: { id: { in: orders.map((o) => o.companyId!).filter(Boolean) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const transporters = new Map((await prisma.agency.findMany({ where: { id: { in: orders.map((o) => o.transporterId!).filter(Boolean) } }, select: { id: true, companyName: true } })).map((t) => [t.id, t.companyName]));
  const active = orders.filter((o) => ['CONFIRMED', 'FULFILLED'].includes(o.status));
  ok(res, 'Service orders', {
    orders: orders.map((o) => ({ ...o, customer: o.companyId ? companies.get(o.companyId) : o.transporterId ? transporters.get(o.transporterId) : null })),
    revenue: { gross: active.reduce((s, o) => s + o.totalAmount.toNumber(), 0), net: active.reduce((s, o) => s + o.totalAmount.toNumber() - o.taxAmount.toNumber(), 0), margin: active.reduce((s, o) => s + o.totalAmount.toNumber() - o.taxAmount.toNumber() - o.costAmount.toNumber(), 0) },
  });
});

/** Assign a service to a company or transporter (creates an order priced from the service master). */
adminServicesRouter.post('/orders', can('services', 'assign'), async (req: Request, res: Response) => {
  const input = body(req, z.object({ serviceId: z.string().uuid(), customerType: z.enum(['COMPANY', 'TRANSPORTER']), customerId: z.string().uuid(), quantity: z.number().int().min(1).max(1000).default(1), notes: z.string().trim().max(1000).optional() }));
  const svc = await prisma.service.findUnique({ where: { id: input.serviceId } });
  if (!svc || !svc.isActive || svc.availability === 'UNAVAILABLE') throw AppError.badRequest('Service is not available');
  const exists = input.customerType === 'COMPANY' ? await prisma.company.findUnique({ where: { id: input.customerId } }) : await prisma.agency.findUnique({ where: { id: input.customerId } });
  if (!exists) throw AppError.badRequest('Customer not found');
  const net = svc.sellingPrice.times(input.quantity);
  const tax = round2(net.times(svc.taxRate).dividedBy(100));
  const o = await prisma.$transaction(async (tx) => {
    const o = await tx.serviceOrder.create({
      data: {
        orderCode: await nextCodeRaw(tx, 'service_order_code_seq', 'SO', 7),
        serviceId: svc.id,
        customerType: input.customerType,
        companyId: input.customerType === 'COMPANY' ? input.customerId : null,
        transporterId: input.customerType === 'TRANSPORTER' ? input.customerId : null,
        quantity: input.quantity,
        unitPrice: svc.sellingPrice,
        taxAmount: tax,
        totalAmount: round2(net.plus(tax)),
        costAmount: round2(svc.costPrice.times(input.quantity)),
        assignedEmployeeId: req.admin!.employeeId,
        notes: input.notes,
        createdById: req.admin!.userId,
      },
    });
    await audit({ action: 'service.order_created', entityType: 'service_order', entityId: o.id, module: 'services', newValue: { service: svc.name, customerId: input.customerId, total: o.totalAmount.toNumber() }, req }, tx);
    return o;
  });
  created(res, 'Service assigned', { order: o });
});

adminServicesRouter.put('/orders/:id', can('services', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const { status } = body(req, z.object({ status: z.enum(['REQUESTED', 'CONFIRMED', 'FULFILLED', 'CANCELLED']) }));
  const o = await prisma.serviceOrder.findUnique({ where: { id } });
  if (!o) throw AppError.notFound('Order not found');
  await prisma.serviceOrder.update({ where: { id }, data: { status } });
  await audit({ action: 'service.order_status', entityType: 'service_order', entityId: id, module: 'services', previousValue: { status: o.status }, newValue: { status }, req });
  ok(res, 'Order updated', null);
});
