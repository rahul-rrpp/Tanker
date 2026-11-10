import type { Prisma, TicketCategory, TicketStatus, TripStatus } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { nextCode } from '../../lib/codes';
import { prisma } from '../../lib/prisma';
import { storage } from '../../lib/storage';
import { multipart, sendStoredFile, storeUpload, type StoredFile } from '../../middleware/upload';
import { AppError, ErrorCode } from '../../utils/errors';
import { created, ok } from '../../utils/response';
import { assertInScope, assignedIds, body, can, dateRange, hasPermission, idOf, insensitive, parseList, respondList, win, type Column } from '../admin/core';
import { addNote, notesFor } from '../admin/parties.routes';
import { audit } from '../audit/audit';
import { createBooking } from '../bookings/booking.service';
import { createBookingSchema } from '../bookings/booking.schemas';
import { notify, notifyTransporter, notifyUser } from '../notifications/notification.service';
import { ACTIVE_TRIP, getTrackingScoped } from '../trips/trip.service';
import { assertActiveEmployee, empId, isAll, member, uid } from './common';

/**
 * Operations views. There is deliberately no route that accepts an offer or edits agreed freight.
 * ASSIGNED-scope employees reach only the companies assigned to them.
 */
export const opsRouter = Router();
opsRouter.use(...member);

const companyIn = async (req: Request) => {
  const ids = await assignedIds(req, 'COMPANY');
  return ids ? { in: ids } : undefined;
};

async function bookingOr404(req: Request) {
  const b = await prisma.booking.findUnique({ where: { id: idOf(req) }, select: { id: true, companyId: true, bookingCode: true, status: true } });
  if (!b) throw AppError.notFound('Booking not found');
  await assertInScope(req, 'COMPANY', b.companyId).catch(() => { throw AppError.notFound('Booking not found'); });
  return b;
}

const loc = (ls: { type: string; city: string | null }[], t: string) => ls.find((l) => l.type === t)?.city ?? null;
const OPEN_BOOKING = ['SEARCHING', 'OFFERS_RECEIVED', 'NEGOTIATION'] as const;

opsRouter.get('/bookings', can('bookings', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { status: z.string().optional(), unallocated: z.string().optional() });
  const where: Prisma.BookingWhereInput = {
    companyId: await companyIn(req),
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.unallocated === '1' ? { status: { in: [...OPEN_BOOKING] }, allocations: { none: {} } } : {}),
    ...(q.q ? { OR: [{ bookingCode: insensitive(q.q) }, { company: { name: insensitive(q.q) } }] } : {}),
    ...(dateRange(q) ? { createdAt: dateRange(q) } : {}),
  };
  const fetch = (paged: boolean) => prisma.booking.findMany({ where, orderBy: { createdAt: 'desc' }, ...win(q, paged), select: { id: true, bookingCode: true, status: true, customerOffer: true, acceptedFreight: true, loadingDate: true, isDemo: true, company: { select: { name: true } }, product: { select: { name: true } }, requirement: { select: { tankerCapacityKl: true } }, locations: { select: { type: true, city: true } }, offers: { where: { status: { in: ['PENDING', 'COUNTERED'] } }, orderBy: { currentAmount: 'asc' }, take: 1, select: { currentAmount: true } } } });
  const shape = (rows: Awaited<ReturnType<typeof fetch>>) => rows.map((b) => ({ id: b.id, bookingCode: b.bookingCode, company: b.company.name, pickup: loc(b.locations, 'PICKUP'), delivery: loc(b.locations, 'DELIVERY'), product: b.product.name, tankerCapacityKl: b.requirement?.tankerCapacityKl.toNumber(), customerOffer: b.customerOffer.toNumber(), transporterOffer: b.offers[0]?.currentAmount.toNumber() ?? null, acceptedFreight: b.acceptedFreight?.toNumber() ?? null, status: b.status, loadingDate: b.loadingDate, isDemo: b.isDemo }));
  const columns: Column[] = [{ key: 'bookingCode', label: 'Booking', format: 'text' }, { key: 'company', label: 'Company', format: 'text' }, { key: 'pickup', label: 'Pickup', format: 'text' }, { key: 'delivery', label: 'Delivery', format: 'text' }, { key: 'customerOffer', label: 'Customer offer', format: 'currency' }, { key: 'acceptedFreight', label: 'Accepted', format: 'currency' }, { key: 'status', label: 'Status', format: 'text' }, { key: 'loadingDate', label: 'Loading', format: 'date' }];
  const [total, rows] = await Promise.all([prisma.booking.count({ where }), fetch(true)]);
  await respondList(req, res, { title: 'Bookings', q, columns, total, rows: shape(rows), exportRows: async () => shape(await fetch(false)), module: 'bookings' });
});

/** Manual booking on a company's behalf. The company's authorisation is mandatory and stored with the booking. */
opsRouter.post('/bookings', can('bookings', 'create'), async (req: Request, res: Response) => {
  const input = body(req, z.object({ companyId: z.string().uuid(), authorization: z.object({ mode: z.enum(['PHONE_CALL', 'EMAIL', 'WHATSAPP', 'WRITTEN', 'IN_PERSON']), reference: z.string().trim().min(3).max(200), authorizedBy: z.string().trim().min(2).max(120), authorizedAt: z.coerce.date() }).strict(), booking: z.unknown() }).strict());
  await assertInScope(req, 'COMPANY', input.companyId);
  const company = await prisma.company.findUnique({ where: { id: input.companyId } });
  if (!company) throw AppError.notFound('Company not found');
  if (company.status !== 'VERIFIED') throw AppError.conflict('Bookings can be created only for verified companies', ErrorCode.COMPANY_NOT_ELIGIBLE);
  const parsed = createBookingSchema.safeParse(input.booking);
  if (!parsed.success) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Please correct the booking details', parsed.error.issues.map((i) => ({ field: `booking.${i.path.join('.')}`, message: i.message })));
  const authorization = { ...input.authorization, authorizedAt: input.authorization.authorizedAt.toISOString(), recordedBy: uid(req), recordedByName: req.admin!.name, recordedAt: new Date().toISOString() };
  const booking = await createBooking(company.id, uid(req), parsed.data, req, { source: 'ADMIN_ASSISTED', customerAuthorization: authorization });
  await audit({ action: 'booking.created_by_employee', entityType: 'booking', entityId: booking.id, companyId: company.id, module: 'bookings', actorType: 'EMPLOYEE', newValue: { bookingCode: booking.bookingCode, authorization }, req });
  await notify({ companyId: company.id, type: 'BOOKING_CREATED', title: `Booking ${booking.bookingCode} created on your behalf`, message: `${req.admin!.name} (TankerLink) created this as authorised by ${input.authorization.authorizedBy}.`, bookingId: booking.id });
  created(res, `Booking ${booking.bookingCode} created`, { booking: { id: booking.id, bookingCode: booking.bookingCode } });
});

opsRouter.get('/bookings/:id', can('bookings', 'view'), async (req: Request, res: Response) => {
  const b0 = await bookingOr404(req);
  const [booking, offers, trips, notes] = await Promise.all([
    prisma.booking.findUniqueOrThrow({ where: { id: b0.id }, include: { company: { select: { id: true, name: true, contactPersonName: true, contactPhone: true } }, product: { select: { name: true } }, requirement: true, locations: true, statusHistory: { orderBy: { createdAt: 'asc' } } } }),
    hasPermission(req, 'offers', 'view') ? prisma.transporterOffer.findMany({ where: { bookingId: b0.id }, include: { transporter: { select: { companyName: true, owner: { select: { phone: true } } } }, history: { orderBy: { createdAt: 'asc' } } } }) : [],
    prisma.trip.findMany({ where: { bookingId: b0.id }, select: { id: true, tripCode: true, status: true } }),
    notesFor('BOOKING', b0.id),
  ]);
  ok(res, 'Booking', { booking, offers, trips, notes });
});

opsRouter.post('/bookings/:id/notes', can('bookings', 'edit'), async (req: Request, res: Response) => {
  const b = await bookingOr404(req);
  const { note } = body(req, z.object({ note: z.string().trim().min(2).max(2000) }).strict());
  created(res, 'Note added', { note: await addNote(req, 'BOOKING', b.id, note) });
});

opsRouter.post('/bookings/:id/flag-delayed', can('bookings', 'edit'), async (req: Request, res: Response) => {
  const b = await bookingOr404(req);
  const { reason } = body(req, z.object({ reason: z.string().trim().min(5).max(500) }).strict());
  await addNote(req, 'BOOKING', b.id, `DELAY FLAG: ${reason}`);
  ok(res, 'Booking flagged as delayed', null);
});

async function raiseIssue(req: Request, input: { companyId: string; bookingId?: string; category: TicketCategory; subject: string; description: string; priority?: string }) {
  const t = await prisma.$transaction(async (tx) => {
    const row = await tx.supportTicket.create({ data: { ticketNumber: await nextCode(tx, 'ticket'), companyId: input.companyId, bookingId: input.bookingId, category: input.category, subject: input.subject, description: input.description, priority: input.priority ?? 'HIGH', raisedByType: 'EMPLOYEE', createdById: uid(req), assignedEmployeeId: empId(req), status: 'ASSIGNED' } });
    await audit({ action: 'support.issue_raised', entityType: 'support_ticket', entityId: row.id, companyId: input.companyId, module: 'complaints', actorType: 'EMPLOYEE', metadata: { category: input.category }, req }, tx);
    return row;
  });
  return t;
}

const issueBody = z.object({ subject: z.string().trim().min(5).max(160), description: z.string().trim().min(10).max(4000) }).strict();

opsRouter.post('/bookings/:id/issue', can('bookings', 'edit'), async (req: Request, res: Response) => {
  const b = await bookingOr404(req);
  const t = await raiseIssue(req, { companyId: b.companyId, bookingId: b.id, category: 'BOOKING_ISSUE', ...body(req, issueBody) });
  created(res, `Issue ${t.ticketNumber} raised`, { ticket: { id: t.id, ticketNumber: t.ticketNumber } });
});

// ---- Negotiation monitoring: read, notify, flag and note only --------------------------------------

async function offerOr404(req: Request) {
  const o = await prisma.transporterOffer.findUnique({ where: { id: idOf(req) }, select: { id: true, bookingId: true, transporterId: true, status: true, booking: { select: { companyId: true, bookingCode: true } } } });
  if (!o) throw AppError.notFound('Offer not found');
  await assertInScope(req, 'COMPANY', o.booking.companyId).catch(() => { throw AppError.notFound('Offer not found'); });
  return o;
}

opsRouter.get('/negotiations', can('offers', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { status: z.string().optional() });
  const where: Prisma.TransporterOfferWhereInput = { booking: { companyId: await companyIn(req), ...(q.q ? { bookingCode: insensitive(q.q) } : {}) }, status: q.status ? (q.status as never) : { in: ['PENDING', 'COUNTERED'] } };
  const [total, rows] = await Promise.all([prisma.transporterOffer.count({ where }), prisma.transporterOffer.findMany({ where, orderBy: { expiresAt: 'asc' }, ...win(q, true), include: { transporter: { select: { companyName: true } }, booking: { select: { id: true, bookingCode: true, customerOffer: true, company: { select: { name: true } } } } } })]);
  ok(res, 'Negotiations', { total, page: q.page, pageSize: q.pageSize, items: rows.map((o) => ({ id: o.id, bookingId: o.booking.id, bookingCode: o.booking.bookingCode, company: o.booking.company.name, transporter: o.transporter.companyName, companyOffer: o.booking.customerOffer.toNumber(), transporterOffer: o.initialAmount.toNumber(), latest: o.currentAmount.toNumber(), lastActionBy: o.lastActionBy, round: o.round, expiresAt: o.expiresAt, status: o.status })) });
});

opsRouter.get('/negotiations/:id', can('offers', 'view'), async (req: Request, res: Response) => {
  const ref = await offerOr404(req);
  const [offer, notes] = await Promise.all([prisma.transporterOffer.findUniqueOrThrow({ where: { id: ref.id }, include: { transporter: { select: { companyName: true, owner: { select: { phone: true } } } }, booking: { select: { id: true, bookingCode: true, customerOffer: true, company: { select: { name: true, contactPhone: true } } } }, history: { orderBy: { createdAt: 'asc' } } } }), notesFor('OFFER', ref.id)]);
  ok(res, 'Negotiation', { offer, notes });
});

opsRouter.post('/negotiations/:id/notes', can('offers', 'edit'), async (req: Request, res: Response) => {
  const o = await offerOr404(req);
  const { note } = body(req, z.object({ note: z.string().trim().min(2).max(2000) }).strict());
  created(res, 'Note added', { note: await addNote(req, 'OFFER', o.id, note) });
});

opsRouter.post('/negotiations/:id/notify', can('offers', 'edit'), async (req: Request, res: Response) => {
  const o = await offerOr404(req);
  const { message } = body(req, z.object({ message: z.string().trim().min(5).max(300) }).strict());
  await notify({ companyId: o.booking.companyId, type: 'SUPPORT_UPDATE', title: `Reminder on ${o.booking.bookingCode}`, message, bookingId: o.bookingId, link: `/company/bookings/${o.bookingId}/offers` });
  await notifyTransporter(o.transporterId, { type: 'SUPPORT_UPDATE', title: `Reminder on ${o.booking.bookingCode}`, message, bookingId: o.bookingId, link: `/transporter/offers/${o.id}` });
  await audit({ action: 'negotiation.parties_notified', entityType: 'transporter_offer', entityId: o.id, module: 'offers', actorType: 'EMPLOYEE', metadata: { message }, req });
  ok(res, 'Both parties notified', null);
});

opsRouter.post('/negotiations/:id/flag-dispute', can('offers', 'edit'), async (req: Request, res: Response) => {
  const o = await offerOr404(req);
  const t = await raiseIssue(req, { companyId: o.booking.companyId, bookingId: o.bookingId, category: 'FREIGHT_DISPUTE', ...body(req, issueBody) });
  created(res, `Dispute ${t.ticketNumber} raised`, { ticket: { id: t.id } });
});

// ---- Trip operations -------------------------------------------------------------------------------

async function tripOr404(req: Request) {
  const t = await prisma.trip.findUnique({ where: { id: idOf(req) }, select: { id: true, status: true, bookingId: true, tripCode: true, booking: { select: { companyId: true } } } });
  if (!t) throw AppError.notFound('Trip not found');
  await assertInScope(req, 'COMPANY', t.booking.companyId).catch(() => { throw AppError.notFound('Trip not found'); });
  return t;
}

const tripInclude = {
  transporter: { select: { companyName: true, owner: { select: { phone: true } } } },
  tanker: { select: { registrationNumber: true } },
  driver: { select: { user: { select: { fullName: true, phone: true } } } },
  booking: { select: { id: true, bookingCode: true, loadingDate: true, loadingTime: true, expectedDeliveryDate: true, company: { select: { name: true, contactPhone: true } }, locations: { select: { type: true, city: true } } } },
} satisfies Prisma.TripInclude;

type TripRow = Prisma.TripGetPayload<{ include: typeof tripInclude }>;

/** Conditions derived from the trip itself, combined with the stored GPS / route alerts. */
function derivedAlerts(t: TripRow) {
  const out: string[] = [];
  const loadAt = new Date(`${t.booking.loadingDate.toISOString().slice(0, 10)}T${t.booking.loadingTime}:00+05:30`).getTime();
  const due = new Date(`${t.booking.expectedDeliveryDate.toISOString().slice(0, 10)}T23:59:59+05:30`).getTime();
  const now = Date.now();
  const soon = loadAt - now < 24 * 3600_000;
  if (!t.tankerId && soon) out.push('VEHICLE_NOT_ASSIGNED');
  if (t.tankerId && !t.driverId && soon) out.push('DRIVER_NOT_ASSIGNED');
  if (now > loadAt && (['SCHEDULED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'DRIVER_ACCEPTED', 'REACHED_PICKUP'] as TripStatus[]).includes(t.status)) out.push('LOADING_DELAY');
  if (now > due && !(['DELIVERED', 'COMPLETED', 'CANCELLED'] as TripStatus[]).includes(t.status)) out.push('DELIVERY_DELAY');
  return out;
}

const shapeTrip = (t: TripRow) => ({ id: t.id, tripCode: t.tripCode, status: t.status, exception: t.exception, isSimulated: t.isSimulated, lastGpsAt: t.lastGpsAt, etaAt: t.etaAt, bookingId: t.booking.id, bookingCode: t.booking.bookingCode, company: t.booking.company.name, companyPhone: t.booking.company.contactPhone, transporter: t.transporter.companyName, transporterPhone: t.transporter.owner.phone, tanker: t.tanker?.registrationNumber ?? null, driver: t.driver?.user.fullName ?? null, driverPhone: t.driver?.user.phone ?? null, pickup: loc(t.booking.locations, 'PICKUP'), delivery: loc(t.booking.locations, 'DELIVERY'), loadingDate: t.booking.loadingDate, expectedDeliveryDate: t.booking.expectedDeliveryDate, alerts: derivedAlerts(t) });

opsRouter.get('/trips', can('trips', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { scope: z.string().optional() });
  const where: Prisma.TripWhereInput = { booking: { companyId: await companyIn(req) }, ...(q.scope === 'all' ? {} : { status: { in: ACTIVE_TRIP } }), ...(q.q ? { OR: [{ tripCode: insensitive(q.q) }, { booking: { bookingCode: insensitive(q.q) } }] } : {}) };
  const [total, rows] = await Promise.all([prisma.trip.count({ where }), prisma.trip.findMany({ where, include: tripInclude, orderBy: { createdAt: 'desc' }, ...win(q, true) })]);
  const stored = await prisma.tripAlert.findMany({ where: { tripId: { in: rows.map((r) => r.id) }, resolvedAt: null }, select: { tripId: true, type: true } });
  ok(res, 'Trips', { total, page: q.page, pageSize: q.pageSize, items: rows.map((t) => { const s = shapeTrip(t); return { ...s, alerts: [...s.alerts, ...stored.filter((a) => a.tripId === t.id).map((a) => a.type)] }; }) });
});

opsRouter.get('/trips/:id', can('trips', 'view'), async (req: Request, res: Response) => {
  const ref = await tripOr404(req);
  const [t, history, documents, alerts, tracking] = await Promise.all([
    prisma.trip.findUniqueOrThrow({ where: { id: ref.id }, include: tripInclude }),
    prisma.tripStatusHistory.findMany({ where: { tripId: ref.id }, orderBy: { createdAt: 'asc' } }),
    prisma.tripDocument.findMany({ where: { tripId: ref.id }, orderBy: { createdAt: 'desc' }, select: { id: true, type: true, title: true, createdAt: true } }),
    prisma.tripAlert.findMany({ where: { tripId: ref.id }, orderBy: { detectedAt: 'desc' }, take: 50 }),
    hasPermission(req, 'tracking', 'view') ? getTrackingScoped({}, ref.id) : null,
  ]);
  ok(res, 'Trip', { trip: shapeTrip(t), history, documents, alerts, tracking });
});

opsRouter.get('/trips/:id/documents/:docId', can('trips', 'view'), async (req: Request, res: Response) => {
  const t = await tripOr404(req);
  const d = await prisma.tripDocument.findFirst({ where: { id: String(req.params.docId), tripId: t.id } });
  if (!d) throw AppError.notFound('Document not found');
  sendStoredFile(res, d, req.query.inline === '1');
});

opsRouter.post('/trips/:id/issue', can('trips', 'edit'), async (req: Request, res: Response) => {
  const t = await tripOr404(req);
  const i = await raiseIssue(req, { companyId: t.booking.companyId, bookingId: t.bookingId, category: 'VEHICLE_DELAY', ...body(req, issueBody) });
  created(res, `Issue ${i.ticketNumber} raised`, { ticket: { id: i.id } });
});

const CORRECTABLE = ['SCHEDULED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'DRIVER_ACCEPTED', 'REACHED_PICKUP', 'LOADING', 'LOADING_COMPLETED', 'IN_TRANSIT', 'REACHED_DESTINATION', 'UNLOADING_STARTED', 'UNLOADING_COMPLETED'] as const;

/** Authorised correction: keeps the previous value and reason. Closing a trip stays with the normal workflow, so settlement logic cannot be skipped. */
opsRouter.post('/trips/:id/correct-status', can('trips', 'edit'), async (req: Request, res: Response) => {
  const t = await tripOr404(req);
  if ((['COMPLETED', 'CANCELLED'] as TripStatus[]).includes(t.status)) throw AppError.conflict('A closed trip cannot be corrected here', ErrorCode.INVALID_STATE_TRANSITION);
  const { status, reason } = body(req, z.object({ status: z.enum(CORRECTABLE), reason: z.string().trim().min(10, 'Explain the correction').max(500) }).strict());
  await prisma.$transaction(async (tx) => {
    await tx.trip.update({ where: { id: t.id }, data: { status } });
    await tx.tripStatusHistory.create({ data: { tripId: t.id, fromStatus: t.status, toStatus: status, isCorrection: true, reason, actorType: 'EMPLOYEE', actorUserId: uid(req) } });
    await audit({ action: 'trip.status_corrected', entityType: 'trip', entityId: t.id, module: 'trips', actorType: 'EMPLOYEE', previousValue: { status: t.status }, newValue: { status, reason }, req }, tx);
  });
  ok(res, 'Trip status corrected', null);
});

// ---- Customer support ------------------------------------------------------------------------------

const CATEGORIES = ['BOOKING_ISSUE', 'TRANSPORTER_ISSUE', 'DRIVER_ISSUE', 'FREIGHT_DISPUTE', 'LOADING_PROBLEM', 'DELIVERY_PROBLEM', 'PAYMENT_PROBLEM', 'TECHNICAL_SUPPORT'] as const;

const ticketScope = (req: Request): Prisma.SupportTicketWhereInput => (isAll(req) ? {} : { assignedEmployeeId: empId(req) });

async function ticketOr404(req: Request) {
  const t = await prisma.supportTicket.findFirst({ where: { id: idOf(req), ...ticketScope(req) } });
  if (!t) throw AppError.notFound('Ticket not found');
  return t;
}

opsRouter.get('/support/tickets', can('complaints', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { status: z.string().optional(), mine: z.string().optional() });
  const where: Prisma.SupportTicketWhereInput = { ...ticketScope(req), ...(q.mine === '1' ? { assignedEmployeeId: empId(req) } : {}), ...(q.status ? { status: q.status as TicketStatus } : {}), ...(q.q ? { OR: [{ ticketNumber: insensitive(q.q) }, { subject: insensitive(q.q) }] } : {}) };
  const [total, items] = await Promise.all([prisma.supportTicket.count({ where }), prisma.supportTicket.findMany({ where, orderBy: { createdAt: 'desc' }, ...win(q, true), include: { company: { select: { name: true } }, transporter: { select: { companyName: true } }, booking: { select: { bookingCode: true } } } })]);
  ok(res, 'Tickets', { total, page: q.page, pageSize: q.pageSize, items });
});

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

opsRouter.post('/support/tickets', can('complaints', 'edit'), multipart({ field: 'attachments', maxFiles: 5 }), async (req: Request, res: Response) => {
  const input = z.object({ companyId: z.string().uuid(), bookingId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)), category: z.enum(CATEGORIES), subject: z.string().trim().min(5).max(160), description: z.string().trim().min(10).max(4000), priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM') }).strict().parse(req.body ?? {});
  await assertInScope(req, 'COMPANY', input.companyId);
  if (!(await prisma.company.count({ where: { id: input.companyId } }))) throw AppError.notFound('Company not found');
  if (input.bookingId && !(await prisma.booking.count({ where: { id: input.bookingId, companyId: input.companyId } }))) throw AppError.badRequest('That booking does not belong to this company');
  const stored = await storeAll((req.files as Express.Multer.File[] | undefined) ?? []);
  const t = await raiseIssue(req, input);
  if (stored.length) await prisma.supportAttachment.createMany({ data: stored.map((s) => ({ ...s, ticketId: t.id })) });
  created(res, `Ticket ${t.ticketNumber} created`, { ticket: { id: t.id, ticketNumber: t.ticketNumber } });
});

opsRouter.get('/support/tickets/:id', can('complaints', 'view'), async (req: Request, res: Response) => {
  const t0 = await ticketOr404(req);
  const ticket = await prisma.supportTicket.findUniqueOrThrow({ where: { id: t0.id }, include: { company: { select: { name: true, contactPhone: true } }, transporter: { select: { companyName: true } }, booking: { select: { id: true, bookingCode: true } }, attachments: { select: { id: true, fileName: true } }, activities: { orderBy: { createdAt: 'asc' } } } });
  ok(res, 'Ticket', { ticket });
});

opsRouter.get('/support/tickets/:id/attachments/:att', can('complaints', 'view'), async (req: Request, res: Response) => {
  const t = await ticketOr404(req);
  const a = await prisma.supportAttachment.findFirst({ where: { id: String(req.params.att), ticketId: t.id } });
  if (!a) throw AppError.notFound('Attachment not found');
  sendStoredFile(res, a, req.query.inline === '1');
});

opsRouter.post('/support/tickets/:id/assign', can('complaints', 'assign'), async (req: Request, res: Response) => {
  const t = await ticketOr404(req);
  const { employeeId } = body(req, z.object({ employeeId: z.string().uuid() }).strict());
  const e = await assertActiveEmployee(employeeId);
  await prisma.$transaction(async (tx) => {
    await tx.supportTicket.update({ where: { id: t.id }, data: { assignedEmployeeId: employeeId, ...(t.status === 'OPEN' ? { status: 'ASSIGNED' as const } : {}) } });
    await tx.complaintActivity.create({ data: { ticketId: t.id, type: 'ASSIGN', message: `Assigned to ${e.user.fullName}`, internal: true, actorId: uid(req) } });
    await audit({ action: 'complaint.assigned', entityType: 'support_ticket', entityId: t.id, module: 'complaints', actorType: 'EMPLOYEE', newValue: { employeeId }, req }, tx);
  });
  await notifyUser(e.userId, { type: 'COMPLAINT_ASSIGNED', title: `Ticket ${t.ticketNumber} assigned to you`, message: t.subject, link: `/employee/support/${t.id}` });
  ok(res, 'Ticket assigned', null);
});

opsRouter.post('/support/tickets/:id/respond', can('complaints', 'edit'), async (req: Request, res: Response) => {
  const t = await ticketOr404(req);
  const input = body(req, z.object({ message: z.string().trim().min(2).max(2000), internal: z.boolean().default(false), status: z.enum(['UNDER_REVIEW', 'AWAITING_RESPONSE', 'RESOLVED', 'CLOSED']).optional(), escalate: z.boolean().default(false) }).strict());
  if (t.status === 'CLOSED') throw AppError.conflict('This ticket is closed', ErrorCode.INVALID_STATE_TRANSITION);
  await prisma.$transaction(async (tx) => {
    await tx.complaintActivity.create({ data: { ticketId: t.id, type: input.escalate ? 'PRIORITY' : input.status ? 'STATUS' : 'NOTE', message: input.message, internal: input.internal, fromValue: input.status ? t.status : null, toValue: input.status ?? null, actorId: uid(req) } });
    await tx.supportTicket.update({ where: { id: t.id }, data: { ...(input.status ? { status: input.status } : {}), ...(input.escalate ? { priority: 'URGENT' } : {}), ...(input.status === 'RESOLVED' ? { resolvedAt: new Date(), resolutionNote: input.message.slice(0, 1000) } : {}) } });
    await audit({ action: 'complaint.responded', entityType: 'support_ticket', entityId: t.id, module: 'complaints', actorType: 'EMPLOYEE', newValue: { status: input.status ?? t.status, internal: input.internal, escalate: input.escalate }, req }, tx);
  });
  if (!input.internal) {
    const n = { type: 'SUPPORT_UPDATE' as const, title: `Update on ticket ${t.ticketNumber}`, message: input.message, bookingId: t.bookingId };
    if (t.companyId) await notify({ ...n, companyId: t.companyId, link: `/company/support/${t.id}` });
    if (t.transporterId) await notifyTransporter(t.transporterId, { ...n, link: `/transporter/support/${t.id}` });
  }
  ok(res, 'Response recorded', null);
});

opsRouter.post('/support/tickets/:id/attachments', can('complaints', 'edit'), multipart({ field: 'attachments', maxFiles: 5 }), async (req: Request, res: Response) => {
  const t = await ticketOr404(req);
  const stored = await storeAll((req.files as Express.Multer.File[] | undefined) ?? []);
  if (stored.length) await prisma.supportAttachment.createMany({ data: stored.map((s) => ({ ...s, ticketId: t.id })) });
  created(res, 'Attachment added', null);
});
