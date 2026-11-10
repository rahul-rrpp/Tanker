import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { nextCode } from '../../lib/codes';
import { round2 } from '../../lib/money';
import { prisma } from '../../lib/prisma';
import { issueRealtimeTicket } from '../../lib/realtime';
import { storage } from '../../lib/storage';
import { authenticateUser } from '../../middleware/auth';
import { requireTransporter, transporterCallerOnly } from '../../middleware/transporter';
import { multipart, sendStoredFile, storeUpload, type StoredFile } from '../../middleware/upload';
import { validateRequest } from '../../middleware/validate';
import { AppError, ErrorCode } from '../../utils/errors';
import { created, ok } from '../../utils/response';
import { nextCodeRaw } from '../admin/codes';
import { audit } from '../audit/audit';
import { notifyTransporter } from '../notifications/notification.service';
import { idParam, tid, uid } from './common';

// ---- Realtime ticket ---------------------------------------------------------------------------

export const realtimeRouter = Router();
realtimeRouter.get('/ticket', authenticateUser, (req, res) => {
  ok(res, 'Ticket', { ticket: issueRealtimeTicket(req.auth!.principal.userId) });
});

// ---- Support: shares the Admin Portal's complaint tables -----------------------------------------

export const TRANSPORTER_TICKET_CATEGORIES = ['BOOKING_ISSUE', 'FREIGHT_NEGOTIATION', 'COMPANY_DISPUTE', 'DRIVER_ISSUE', 'GPS_ISSUE', 'PAYMENT_PROBLEM', 'SETTLEMENT_ISSUE', 'DOCUMENT_VERIFICATION', 'TECHNICAL_SUPPORT'] as const;

export const transporterSupportRouter = Router();
const support = [authenticateUser, transporterCallerOnly, requireTransporter({ permission: 'agency:support:manage' })];

const ticketSchema = z
  .object({
    category: z.enum(TRANSPORTER_TICKET_CATEGORIES, { errorMap: () => ({ message: 'Select a category' }) }),
    bookingId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
    subject: z.string().trim().min(5, 'Add a short subject').max(160),
    description: z.string().trim().min(20, 'Describe the issue in at least 20 characters').max(4000),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  })
  .strict();

/** Stores uploads, cleaning up any already written if a later one is rejected. */
async function storeAll(files: Express.Multer.File[]) {
  const stored: StoredFile[] = [];
  try {
    for (const f of files) stored.push(await storeUpload(f, 'support-attachments', ['pdf', 'png', 'jpeg', 'webp']));
    return stored;
  } catch (e) {
    await Promise.all(stored.map((s) => storage.remove(s.storageKey)));
    throw e;
  }
}

async function assertOwnBooking(transporterId: string, bookingId: string) {
  const mine = await prisma.booking.count({ where: { id: bookingId, OR: [{ allocations: { some: { transporterId } } }, { offers: { some: { transporterId } } }] } });
  if (!mine) throw AppError.badRequest('Booking not found', undefined, [{ field: 'bookingId', message: 'Select one of your bookings' }]);
}

transporterSupportRouter.post('/tickets', ...support, multipart({ field: 'attachments', maxFiles: 5 }), async (req: Request, res: Response) => {
  const input = ticketSchema.parse(req.body ?? {});
  if (input.bookingId) await assertOwnBooking(tid(req), input.bookingId);
  const stored = await storeAll((req.files as Express.Multer.File[] | undefined) ?? []);
  const ticket = await prisma.$transaction(async (tx) => {
    const t = await tx.supportTicket.create({
      data: { ticketNumber: await nextCode(tx, 'ticket'), transporterId: tid(req), raisedByType: 'TRANSPORTER', bookingId: input.bookingId, category: input.category, subject: input.subject, description: input.description, priority: input.priority, createdById: uid(req), attachments: { create: stored } },
      include: { attachments: { select: { id: true, fileName: true } } },
    });
    await audit({ action: 'support.ticket_created', entityType: 'support_ticket', entityId: t.id, actorType: 'TRANSPORTER', actorUserId: uid(req), metadata: { category: t.category }, req }, tx);
    return t;
  });
  await notifyTransporter(tid(req), { type: 'SUPPORT_UPDATE', title: `Ticket ${ticket.ticketNumber} raised`, message: 'Our support team will review it and update you here.', bookingId: ticket.bookingId, link: `/transporter/support/${ticket.id}` });
  created(res, 'Ticket raised', { ticket });
});

transporterSupportRouter.get('/tickets', ...support, async (req: Request, res: Response) => {
  const tickets = await prisma.supportTicket.findMany({ where: { transporterId: tid(req) }, orderBy: { createdAt: 'desc' }, take: 200, include: { booking: { select: { id: true, bookingCode: true } }, _count: { select: { attachments: true } } } });
  ok(res, 'Tickets', { tickets });
});

async function ownTicket(req: Request) {
  const t = await prisma.supportTicket.findFirst({
    where: { id: String(req.params.id), transporterId: tid(req) },
    include: {
      booking: { select: { id: true, bookingCode: true } },
      attachments: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true } },
      // Internal staff notes are never returned to the transporter.
      activities: { where: { internal: false }, orderBy: { createdAt: 'asc' }, select: { id: true, type: true, message: true, fromValue: true, toValue: true, actorId: true, createdAt: true } },
      createdBy: { select: { fullName: true } },
    },
  });
  if (!t) throw AppError.notFound('Ticket not found');
  return t;
}

transporterSupportRouter.get('/tickets/:id', ...support, idParam, async (req: Request, res: Response) => ok(res, 'Ticket', { ticket: await ownTicket(req) }));

transporterSupportRouter.post('/tickets/:id/replies', ...support, idParam, multipart({ field: 'attachments', maxFiles: 5 }), async (req: Request, res: Response) => {
  const t = await ownTicket(req);
  if (t.status === 'CLOSED') throw AppError.conflict('This ticket is closed. Reopen it to reply.', ErrorCode.INVALID_STATE_TRANSITION);
  const { message } = z.object({ message: z.string().trim().min(2).max(2000) }).strict().parse(req.body ?? {});
  const stored = await storeAll((req.files as Express.Multer.File[] | undefined) ?? []);
  await prisma.$transaction(async (tx) => {
    await tx.complaintActivity.create({ data: { ticketId: t.id, type: 'NOTE', message, internal: false, actorId: uid(req) } });
    if (stored.length) await tx.supportAttachment.createMany({ data: stored.map((s) => ({ ...s, ticketId: t.id })) });
  });
  created(res, 'Reply added', null);
});

transporterSupportRouter.post('/tickets/:id/reopen', ...support, idParam, validateRequest({ body: z.object({ reason: z.string().trim().min(5).max(500) }).strict() }), async (req: Request, res: Response) => {
  const t = await ownTicket(req);
  if (t.status !== 'RESOLVED' && t.status !== 'CLOSED') throw AppError.conflict('Only resolved or closed tickets can be reopened', ErrorCode.INVALID_STATE_TRANSITION);
  await prisma.$transaction(async (tx) => {
    await tx.supportTicket.update({ where: { id: t.id }, data: { status: 'OPEN', resolvedAt: null } });
    await tx.complaintActivity.create({ data: { ticketId: t.id, type: 'REOPEN', message: req.body.reason, internal: false, fromValue: t.status, toValue: 'OPEN', actorId: uid(req) } });
  });
  ok(res, 'Ticket reopened', null);
});

transporterSupportRouter.get('/tickets/:id/attachments/:attachmentId', ...support, validateRequest({ params: z.object({ id: z.string().uuid(), attachmentId: z.string().uuid() }) }), async (req: Request, res: Response) => {
  const att = await prisma.supportAttachment.findFirst({ where: { id: String(req.params.attachmentId), ticketId: String(req.params.id), ticket: { transporterId: tid(req) } } });
  if (!att) throw AppError.notFound('Attachment not found');
  sendStoredFile(res, att, req.query.inline === '1');
});

// ---- Subscriptions -------------------------------------------------------------------------------

export const subscriptionRouter = Router();
const owner = [authenticateUser, requireTransporter({ permission: 'agency:finance:access' })];

subscriptionRouter.get('/me/subscription', ...owner, async (req, res) => {
  await prisma.subscription.updateMany({ where: { transporterId: tid(req), status: 'ACTIVE', endAt: { lt: new Date() } }, data: { status: 'EXPIRED' } });
  const history = await prisma.subscription.findMany({ where: { transporterId: tid(req) }, orderBy: { createdAt: 'desc' }, include: { plan: { select: { code: true, name: true, features: true } } } });
  ok(res, 'Subscription', { current: history.find((s) => s.status === 'ACTIVE') ?? null, pending: history.find((s) => s.status === 'PENDING') ?? null, history });
});

/**
 * Free plans activate at once. Paid plans are recorded as PENDING and activated by the Admin Portal
 * once payment is confirmed: the payment gateway records in this codebase are tied to bookings.
 */
subscriptionRouter.post('/me/subscription-orders', ...owner, validateRequest({ body: z.object({ planId: z.string().uuid() }).strict() }), async (req: Request, res: Response) => {
  const plan = await prisma.subscriptionPlan.findFirst({ where: { id: req.body.planId, userCategory: 'TRANSPORTER', isActive: true } });
  if (!plan) throw AppError.notFound('Plan not found');
  const free = plan.price.isZero();
  const sub = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sub|${tid(req)}`}))`;
    if (await tx.subscription.count({ where: { transporterId: tid(req), status: 'PENDING' } })) throw AppError.conflict('You already have a plan awaiting payment');
    const current = await tx.subscription.findFirst({ where: { transporterId: tid(req), status: 'ACTIVE', endAt: { gt: new Date() } }, orderBy: { endAt: 'desc' } });
    if (free && current) throw AppError.conflict('You already have an active plan');
    const startAt = current?.endAt ?? new Date();
    const row = await tx.subscription.create({
      data: { subscriptionCode: await nextCodeRaw(tx, 'subscription_code_seq', 'SUB', 6), planId: plan.id, subscriberType: 'TRANSPORTER', transporterId: tid(req), startAt, endAt: new Date(startAt.getTime() + plan.validityDays * 86400_000), amount: plan.price, status: free ? 'ACTIVE' : 'PENDING', renewedFromId: current?.id ?? null, createdById: uid(req) },
    });
    await audit({ action: 'subscription.ordered', entityType: 'subscription', entityId: row.id, actorType: 'TRANSPORTER', actorUserId: uid(req), metadata: { plan: plan.code, status: row.status }, req }, tx);
    return row;
  });
  created(res, free ? 'Plan activated' : 'Plan requested. Our team will contact you to complete payment.', { subscription: sub });
});

// ---- Plans, services, requests -------------------------------------------------------------------

export const servicesRouter = Router();
const member = [authenticateUser, requireTransporter({ permission: 'agency:read' })];

servicesRouter.get('/subscription-plans', ...member, async (_req, res) => {
  const plans = await prisma.subscriptionPlan.findMany({ where: { userCategory: 'TRANSPORTER', isActive: true }, orderBy: { price: 'asc' } });
  ok(res, 'Plans', { plans: plans.map((p) => ({ ...p, price: p.price.toNumber() })) });
});

servicesRouter.get('/services', ...member, async (_req, res) => {
  const services = await prisma.service.findMany({ where: { isActive: true }, orderBy: { category: 'asc' }, select: { id: true, serviceCode: true, name: true, category: true, description: true, sellingPrice: true, taxRate: true, availability: true, requiresLicensedPartner: true, partnerName: true } });
  ok(res, 'Services', { services: services.map((s) => ({ ...s, sellingPrice: s.sellingPrice.toNumber(), taxRate: s.taxRate.toNumber() })) });
});

servicesRouter.get('/service-requests', ...member, async (req, res) => {
  const items = await prisma.serviceOrder.findMany({ where: { transporterId: tid(req) }, orderBy: { createdAt: 'desc' }, take: 100, include: { service: { select: { name: true, category: true } } } });
  ok(res, 'Service requests', { items: items.map((o) => ({ id: o.id, orderCode: o.orderCode, requestType: o.requestType, status: o.status, notes: o.notes, createdAt: o.createdAt, service: o.service })) });
});

servicesRouter.post('/service-requests', ...member, validateRequest({ body: z.object({ serviceId: z.string().uuid(), requestType: z.enum(['ENQUIRY', 'CALLBACK']), notes: z.string().trim().max(1000).optional() }).strict() }), async (req: Request, res: Response) => {
  const s = await prisma.service.findFirst({ where: { id: req.body.serviceId, isActive: true } });
  if (!s) throw AppError.notFound('Service not found');
  const tax = round2(s.sellingPrice.times(s.taxRate).dividedBy(100));
  const order = await prisma.$transaction(async (tx) => {
    const row = await tx.serviceOrder.create({ data: { orderCode: await nextCodeRaw(tx, 'service_order_code_seq', 'SO', 7), serviceId: s.id, customerType: 'TRANSPORTER', transporterId: tid(req), requestType: req.body.requestType, unitPrice: s.sellingPrice, taxAmount: tax, totalAmount: s.sellingPrice.plus(tax), costAmount: s.costPrice, notes: req.body.notes, createdById: uid(req) } });
    await audit({ action: 'service.requested', entityType: 'service_order', entityId: row.id, actorType: 'TRANSPORTER', actorUserId: uid(req), metadata: { type: req.body.requestType }, req }, tx);
    return row;
  });
  created(res, req.body.requestType === 'CALLBACK' ? 'Callback requested' : 'Enquiry submitted', { orderCode: order.orderCode, status: order.status });
});
