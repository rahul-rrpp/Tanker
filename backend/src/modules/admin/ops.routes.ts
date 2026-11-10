import { Prisma, type TripStatus } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { round2 } from '../../lib/money';
import { prisma } from '../../lib/prisma';
import { nextCode } from '../../lib/codes';
import { AppError, ErrorCode } from '../../utils/errors';
import { decodePolyline, haversineKm, type LatLng } from '../../utils/polyline';
import { created, ok } from '../../utils/response';
import { audit } from '../audit/audit';
import { createBookingSchema } from '../bookings/booking.schemas';
import { bookingDetailInclude, cancelBooking, createBooking } from '../bookings/booking.service';
import { bookingSummaryPdf } from '../documents/document.service';
import { notify } from '../notifications/notification.service';
import { acceptOffer } from '../offers/offer.service';
import { invoiceAmounts } from '../payments/payment.calc';
import { getSettings } from '../settings/settings.service';
import { adminAuth, assignedIds, body, can, dateRange, hasPermission, idOf, insensitive, orderBy, parseList, respondList, win, type Column } from './core';
import { addNote, notesFor } from './parties.routes';

const n = (v: Prisma.Decimal | null | undefined) => (v ? v.toNumber() : null);
const city = (locs: { type: string; city: string | null }[], t: string) => locs.find((l) => l.type === t)?.city ?? null;

async function companyScope(req: Request): Promise<Prisma.BookingWhereInput> {
  const ids = await assignedIds(req, 'COMPANY');
  return ids ? { companyId: { in: ids } } : {};
}

async function bookingOr404(req: Request, id = idOf(req)) {
  const b = await prisma.booking.findFirst({ where: { id, ...(await companyScope(req)) }, select: { id: true, companyId: true, status: true, bookingCode: true } });
  if (!b) throw AppError.notFound('Booking not found');
  return b;
}

// ===========================================================================
// Booking management
// ===========================================================================

export const adminBookingsRouter = Router();
adminBookingsRouter.use(...adminAuth);

const bookingColumns: Column[] = [
  { key: 'bookingCode', label: 'Booking ID', format: 'text' },
  { key: 'company', label: 'Company', format: 'text' },
  { key: 'pickup', label: 'Pickup', format: 'text' },
  { key: 'delivery', label: 'Delivery', format: 'text' },
  { key: 'product', label: 'Oil type', format: 'text' },
  { key: 'capacity', label: 'Tanker capacity (KL)', format: 'number' },
  { key: 'quantity', label: 'Quantity (KL)', format: 'number' },
  { key: 'tankers', label: 'Tankers', format: 'number' },
  { key: 'customerOffer', label: 'Customer offer', format: 'currency' },
  { key: 'acceptedFreight', label: 'Accepted freight', format: 'currency' },
  { key: 'transporter', label: 'Transporter', format: 'text' },
  { key: 'createdAt', label: 'Booking date', format: 'datetime' },
  { key: 'status', label: 'Status', format: 'text' },
];

adminBookingsRouter.get('/', can('bookings', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { status: z.string().optional(), companyId: z.string().uuid().optional(), transporterId: z.string().uuid().optional(), productId: z.string().uuid().optional(), source: z.string().optional(), city: z.string().optional() });
  const where: Prisma.BookingWhereInput = {
    ...(await companyScope(req)),
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.companyId ? { companyId: q.companyId as string } : {}),
    ...(q.transporterId ? { allocations: { some: { transporterId: q.transporterId as string } } } : {}),
    ...(q.productId ? { productId: q.productId as string } : {}),
    ...(q.source ? { source: q.source as string } : {}),
    ...(q.city ? { locations: { some: { city: insensitive(q.city as string) } } } : {}),
    ...(q.from || q.to ? { createdAt: dateRange(q) } : {}),
    ...(q.q ? { AND: [{ OR: [{ bookingCode: insensitive(q.q) }, { company: { name: insensitive(q.q) } }, { company: { companyCode: insensitive(q.q) } }] }] } : {}),
  };
  const load = async (paged: boolean) => {
    const rows = await prisma.booking.findMany({
      where,
      orderBy: orderBy(q, ['createdAt', 'customerOffer', 'acceptedFreight', 'status'], 'createdAt'),
      ...win(q, paged),
      include: {
        company: { select: { id: true, name: true, companyCode: true } },
        product: { select: { name: true } },
        locations: { select: { type: true, city: true } },
        requirement: { select: { tankerCapacityKl: true, quantityKl: true, numberOfTankers: true } },
        allocations: { where: { status: { not: 'CANCELLED' } }, select: { transporter: { select: { companyName: true } } } },
      },
    });
    return rows.map((b) => ({
      id: b.id,
      bookingCode: b.bookingCode,
      company: b.company.name,
      companyId: b.company.id,
      pickup: city(b.locations, 'PICKUP'),
      delivery: city(b.locations, 'DELIVERY'),
      product: b.product.name,
      capacity: n(b.requirement?.tankerCapacityKl),
      quantity: n(b.requirement?.quantityKl),
      tankers: b.requirement?.numberOfTankers ?? null,
      customerOffer: n(b.customerOffer),
      acceptedFreight: n(b.acceptedFreight),
      transporter: [...new Set(b.allocations.map((a) => a.transporter.companyName))].join(', ') || null,
      createdAt: b.createdAt,
      status: b.status,
      source: b.source,
      isDemo: b.isDemo,
    }));
  };
  const [total, rows] = await Promise.all([prisma.booking.count({ where }), load(true)]);
  await respondList(req, res, { title: 'Bookings', q, columns: bookingColumns, total, rows, exportRows: () => load(false), module: 'bookings' });
});

/** Manual booking on behalf of a company, with the company's authorisation recorded. */
adminBookingsRouter.post('/', can('bookings', 'create'), async (req: Request, res: Response) => {
  const input = body(
    req,
    z.object({
      companyId: z.string().uuid(),
      authorization: z.object({ mode: z.enum(['PHONE_CALL', 'EMAIL', 'WHATSAPP', 'WRITTEN', 'IN_PERSON']), reference: z.string().trim().min(3).max(200), authorizedBy: z.string().trim().min(2).max(120), authorizedAt: z.coerce.date() }),
      booking: z.unknown(),
    }),
  );
  const scope = await assignedIds(req, 'COMPANY');
  if (scope && !scope.includes(input.companyId)) throw AppError.notFound('Company not found');
  const company = await prisma.company.findUnique({ where: { id: input.companyId } });
  if (!company) throw AppError.notFound('Company not found');
  if (company.status !== 'VERIFIED') throw AppError.conflict('Bookings can be created only for verified companies', ErrorCode.COMPANY_NOT_ELIGIBLE);
  const parsed = createBookingSchema.safeParse(input.booking);
  if (!parsed.success) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Please correct the booking details', parsed.error.issues.map((i) => ({ field: `booking.${i.path.join('.')}`, message: i.message })));
  const authorization = { ...input.authorization, authorizedAt: input.authorization.authorizedAt.toISOString(), recordedBy: req.admin!.userId, recordedByName: req.admin!.name, recordedAt: new Date().toISOString() };
  const booking = await createBooking(company.id, req.admin!.userId, parsed.data, req, { source: 'ADMIN_ASSISTED', customerAuthorization: authorization });
  await audit({ action: 'booking.created_by_admin', entityType: 'booking', entityId: booking.id, companyId: company.id, module: 'bookings', newValue: { bookingCode: booking.bookingCode, authorization }, req });
  await notify({
    companyId: company.id,
    type: 'BOOKING_CREATED',
    title: `Booking ${booking.bookingCode} created on your behalf`,
    message: `${req.admin!.name} (TankerLink) created this booking as authorised by ${input.authorization.authorizedBy} via ${input.authorization.mode.replace('_', ' ').toLowerCase()}.`,
    bookingId: booking.id,
  });
  created(res, `Booking ${booking.bookingCode} created for ${company.name}`, { booking });
});

adminBookingsRouter.get('/:id', can('bookings', 'view'), async (req: Request, res: Response) => {
  const b0 = await bookingOr404(req);
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: b0.id }, include: { ...bookingDetailInclude, company: { select: { id: true, name: true, companyCode: true, contactPhone: true } }, createdBy: { select: { fullName: true } } } });
  const [offers, adjustments, notes, trips] = await Promise.all([
    prisma.transporterOffer.findMany({ where: { bookingId: b0.id }, include: { transporter: { select: { id: true, companyName: true, rating: true, isDemo: true } }, history: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'asc' } }),
    prisma.freightAdjustment.findMany({ where: { bookingId: b0.id }, orderBy: { createdAt: 'desc' } }),
    notesFor('BOOKING', b0.id),
    prisma.trip.findMany({ where: { bookingId: b0.id }, include: { tanker: { select: { registrationNumber: true } }, driver: { select: { user: { select: { fullName: true, phone: true } } } } } }),
  ]);
  ok(res, 'Booking', { booking, offers, adjustments, notes, trips });
});

adminBookingsRouter.get('/:id/pdf', can('bookings', 'view'), async (req: Request, res: Response) => {
  const b = await bookingOr404(req);
  const pdf = await bookingSummaryPdf(b.companyId, b.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="${pdf.fileName}"`);
  res.send(pdf.buffer);
});

adminBookingsRouter.post('/:id/cancel', can('bookings', 'edit'), async (req: Request, res: Response) => {
  const b = await bookingOr404(req);
  const { reason } = body(req, z.object({ reason: z.string().trim().min(5, 'Give a reason').max(450) }));
  await cancelBooking(b.companyId, req.admin!.userId, b.id, `[TankerLink] ${reason}`, req);
  await audit({ action: 'booking.cancelled_by_admin', entityType: 'booking', entityId: b.id, companyId: b.companyId, module: 'bookings', previousValue: { status: b.status }, newValue: { status: 'CANCELLED', reason }, req });
  ok(res, 'Booking cancelled; the company has been notified', null);
});

/** Records an issue resolution; for DISPUTED bookings restores the status held before the dispute. */
adminBookingsRouter.post('/:id/resolve', can('bookings', 'edit'), async (req: Request, res: Response) => {
  const b = await bookingOr404(req);
  const { note } = body(req, z.object({ note: z.string().trim().min(5).max(2000) }));
  await addNote(req, 'BOOKING', b.id, `Resolution: ${note}`);
  if (b.status === 'DISPUTED') {
    const before = await prisma.bookingStatusHistory.findFirst({ where: { bookingId: b.id, toStatus: 'DISPUTED' }, orderBy: { createdAt: 'desc' } });
    const to = before?.fromStatus ?? 'CONFIRMED';
    await prisma.$transaction([
      prisma.booking.update({ where: { id: b.id }, data: { status: to } }),
      prisma.bookingStatusHistory.create({ data: { bookingId: b.id, fromStatus: 'DISPUTED', toStatus: to, actorType: req.admin!.isSuper ? 'ADMIN' : 'EMPLOYEE', actorUserId: req.admin!.userId, note: `Dispute resolved: ${note.slice(0, 400)}` } }),
    ]);
  }
  await audit({ action: 'booking.issue_resolved', entityType: 'booking', entityId: b.id, companyId: b.companyId, module: 'bookings', newValue: { note }, req });
  ok(res, 'Resolution recorded', null);
});

/** Assist allocation: accept an offer for the company when it has authorised TankerLink to do so. */
adminBookingsRouter.post('/:id/assist-allocation', can('bookings', 'edit'), async (req: Request, res: Response) => {
  const b = await bookingOr404(req);
  const { offerId, authorization } = body(req, z.object({ offerId: z.string().uuid(), authorization: z.string().trim().min(5, 'Record how the company authorised this').max(300) }));
  const offer = await prisma.transporterOffer.findFirst({ where: { id: offerId, bookingId: b.id } });
  if (!offer) throw AppError.notFound('Offer not found on this booking');
  const outcome = await acceptOffer(b.companyId, req.admin!.userId, offerId, req);
  await addNote(req, 'BOOKING', b.id, `Allocation accepted by TankerLink for the company. Authorisation: ${authorization}`);
  await audit({ action: 'booking.allocation_assisted', entityType: 'booking', entityId: b.id, companyId: b.companyId, module: 'bookings', newValue: { offerId, authorization, amount: outcome.amount.toNumber() }, req });
  ok(res, outcome.confirmed ? 'Booking confirmed' : `Allocated; ${outcome.tankersRemaining} tanker(s) remaining`, outcome);
});

adminBookingsRouter.post('/:id/notes', can('bookings', 'edit'), async (req: Request, res: Response) => {
  const b = await bookingOr404(req);
  const { note } = body(req, z.object({ note: z.string().trim().min(2).max(2000) }));
  created(res, 'Note added', { note: await addNote(req, 'BOOKING', b.id, note) });
});

// ===========================================================================
// Offers & negotiation monitoring, freight adjustments
// ===========================================================================

export const adminOffersRouter = Router();
adminOffersRouter.use(...adminAuth);

const offerColumns: Column[] = [
  { key: 'bookingCode', label: 'Booking ID', format: 'text' },
  { key: 'company', label: 'Company', format: 'text' },
  { key: 'customerOffer', label: 'Customer offer', format: 'currency' },
  { key: 'transporter', label: 'Transporter', format: 'text' },
  { key: 'transporterOffer', label: 'Transporter offer', format: 'currency' },
  { key: 'latestAmount', label: 'Latest amount', format: 'currency' },
  { key: 'rounds', label: 'Rounds', format: 'number' },
  { key: 'variation', label: 'Variation vs customer', format: 'percent' },
  { key: 'status', label: 'Offer status', format: 'text' },
  { key: 'expiresAt', label: 'Offer expiry', format: 'datetime' },
];

adminOffersRouter.get('/', can('offers', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { status: z.string().optional(), transporterId: z.string().uuid().optional(), bookingId: z.string().uuid().optional(), expiredOnly: z.enum(['true']).optional(), minVariation: z.coerce.number().optional() });
  const where: Prisma.TransporterOfferWhereInput = {
    booking: await companyScope(req),
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.transporterId ? { transporterId: q.transporterId as string } : {}),
    ...(q.bookingId ? { bookingId: q.bookingId as string } : {}),
    ...(q.expiredOnly ? { OR: [{ status: 'EXPIRED' }, { status: { in: ['PENDING', 'COUNTERED'] }, expiresAt: { lt: new Date() } }] } : {}),
    ...(q.from || q.to ? { createdAt: dateRange(q) } : {}),
    ...(q.q ? { AND: [{ OR: [{ booking: { bookingCode: insensitive(q.q) } }, { transporter: { companyName: insensitive(q.q) } }] }] } : {}),
  };
  const load = async (paged: boolean) => {
    const rows = await prisma.transporterOffer.findMany({
      where,
      orderBy: orderBy(q, ['createdAt', 'updatedAt', 'expiresAt', 'currentAmount'], 'updatedAt'),
      ...win(q, paged),
      include: { transporter: { select: { companyName: true } }, booking: { select: { id: true, bookingCode: true, customerOffer: true, company: { select: { name: true } }, requirement: { select: { numberOfTankers: true } } } } },
    });
    return rows
      .map((o) => {
        const perTankerCustomer = o.booking.customerOffer.toNumber() / Math.max(1, o.booking.requirement?.numberOfTankers ?? 1);
        const comparable = perTankerCustomer * o.tankersAvailable;
        return {
          id: o.id,
          bookingId: o.booking.id,
          bookingCode: o.booking.bookingCode,
          company: o.booking.company.name,
          customerOffer: o.booking.customerOffer.toNumber(),
          transporter: o.transporter.companyName,
          transporterOffer: o.initialAmount.toNumber(),
          latestAmount: o.currentAmount.toNumber(),
          rounds: o.round,
          variation: comparable ? Math.round(((o.currentAmount.toNumber() - comparable) / comparable) * 1000) / 10 : 0,
          status: o.status === 'PENDING' || o.status === 'COUNTERED' ? (o.expiresAt < new Date() ? 'EXPIRED' : o.status) : o.status,
          expiresAt: o.expiresAt,
          tankers: o.tankersAvailable,
          isDemo: o.isDemo,
        };
      })
      .filter((r) => (q.minVariation === undefined ? true : Math.abs(r.variation) >= (q.minVariation as number)));
  };
  const [total, rows] = await Promise.all([prisma.transporterOffer.count({ where }), load(true)]);
  await respondList(req, res, { title: 'Offers & negotiations', q, columns: offerColumns, total, rows, exportRows: () => load(false), module: 'offers' });
});

/** Negotiation audit trail: who, amount, previous and new amount, time, resulting status. */
adminOffersRouter.get('/:id', can('offers', 'view'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const o = await prisma.transporterOffer.findFirst({
    where: { id, booking: await companyScope(req) },
    include: { transporter: { select: { companyName: true } }, booking: { select: { id: true, bookingCode: true, customerOffer: true, company: { select: { name: true } } } }, history: { orderBy: { createdAt: 'asc' } }, allocation: true },
  });
  if (!o) throw AppError.notFound('Offer not found');
  const users = new Map((await prisma.user.findMany({ where: { id: { in: o.history.map((h) => h.actorUserId!).filter(Boolean) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  let prev: number | null = o.booking.customerOffer.toNumber();
  const trail = o.history.map((h) => {
    const row = {
      id: h.id,
      submittedBy: h.party === 'COMPANY' ? `${o.booking.company.name}${h.actorUserId ? ` (${users.get(h.actorUserId) ?? 'user'})` : ''}` : h.party === 'TRANSPORTER' ? o.transporter.companyName : 'System',
      party: h.party,
      action: h.action,
      previousAmount: h.amount !== null ? prev : null,
      newAmount: h.amount?.toNumber() ?? null,
      message: h.message,
      at: h.createdAt,
      isDemo: h.isDemo,
    };
    if (h.amount !== null) prev = h.amount.toNumber();
    return row;
  });
  ok(res, 'Offer', { offer: o, trail });
});

adminOffersRouter.get('/adjustments/list', can('offers', 'view'), async (_req: Request, res: Response) => {
  const items = await prisma.freightAdjustment.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: items.flatMap((i) => [i.requestedById, i.reviewedById!]).filter(Boolean) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const bookings = new Map((await prisma.booking.findMany({ where: { id: { in: items.map((i) => i.bookingId) } }, select: { id: true, bookingCode: true } })).map((b) => [b.id, b.bookingCode]));
  ok(res, 'Freight adjustments', { items: items.map((i) => ({ ...i, bookingCode: bookings.get(i.bookingId), requestedBy: users.get(i.requestedById), reviewedBy: i.reviewedById ? users.get(i.reviewedById) : null })) });
});

/** Step 1 of a freight correction: request (never edits the accepted price directly). */
adminOffersRouter.post('/adjustments', can('offers', 'edit'), async (req: Request, res: Response) => {
  const input = body(req, z.object({ allocationId: z.string().uuid(), newAmount: z.number().positive().max(100_000_000), reason: z.string().trim().min(10, 'Explain the correction in detail').max(500) }));
  const a = await prisma.bookingAllocation.findUnique({ where: { id: input.allocationId } });
  if (!a || a.status === 'CANCELLED') throw AppError.notFound('Allocation not found');
  const scope = await assignedIds(req, 'COMPANY');
  if (scope) await bookingOr404(req, a.bookingId);
  if (await prisma.freightAdjustment.findFirst({ where: { allocationId: a.id, status: 'REQUESTED' } })) throw AppError.conflict('A correction for this allocation is already awaiting approval');
  const adj = await prisma.$transaction(async (tx) => {
    const r = await tx.freightAdjustment.create({ data: { allocationId: a.id, bookingId: a.bookingId, previousAmount: a.agreedFreight, newAmount: input.newAmount, reason: input.reason, requestedById: req.admin!.userId } });
    await audit({ action: 'freight.adjustment_requested', entityType: 'freight_adjustment', entityId: r.id, module: 'offers', previousValue: { agreedFreight: a.agreedFreight.toNumber() }, newValue: { requested: input.newAmount, reason: input.reason }, req }, tx);
    return r;
  });
  created(res, 'Correction requested; a second authorised person must approve it', { adjustment: adj });
});

/** Step 2: approve/reject by a different person. Approval re-prices the allocation and re-issues its invoice. */
adminOffersRouter.post('/adjustments/:id/review', can('offers', 'approve'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const { approve, note } = body(req, z.object({ approve: z.boolean(), note: z.string().trim().min(3).max(500) }));
  const adj = await prisma.freightAdjustment.findUnique({ where: { id } });
  if (!adj || adj.status !== 'REQUESTED') throw AppError.notFound('No pending correction');
  if (adj.requestedById === req.admin!.userId) throw AppError.forbidden('A correction must be approved by someone other than the requester');
  const settings = await getSettings();
  await prisma.$transaction(async (tx) => {
    await tx.freightAdjustment.update({ where: { id }, data: { status: approve ? 'APPROVED' : 'REJECTED', reviewedById: req.admin!.userId, reviewNote: note, reviewedAt: new Date() } });
    if (approve) {
      const paid = await tx.payment.count({ where: { bookingId: adj.bookingId, status: 'PAID' } });
      await tx.bookingAllocation.update({ where: { id: adj.allocationId }, data: { agreedFreight: adj.newAmount } });
      const agg = await tx.bookingAllocation.aggregate({ where: { bookingId: adj.bookingId, status: { not: 'CANCELLED' } }, _sum: { agreedFreight: true } });
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: adj.bookingId } });
      if (booking.acceptedFreight) await tx.booking.update({ where: { id: booking.id }, data: { acceptedFreight: agg._sum.agreedFreight } });
      // Invoice: an unpaid allocation invoice is re-issued; if money was already collected a supplementary/credit entry is issued for the difference.
      const old = await tx.invoice.findFirst({ where: { bookingId: adj.bookingId, freightAmount: adj.previousAmount, status: { not: 'CANCELLED' } } });
      const delta = adj.newAmount.minus(adj.previousAmount);
      if (old && !paid) {
        await tx.invoice.update({ where: { id: old.id }, data: { status: 'CANCELLED' } });
        const a = invoiceAmounts(adj.newAmount, settings);
        await tx.invoice.create({ data: { invoiceNumber: await nextCode(tx, 'invoice'), bookingId: adj.bookingId, companyId: booking.companyId, freightAmount: a.freight, platformFee: a.platformFee, gstPercent: settings.gstPercent, gstAmount: a.gst, totalAmount: a.total, dueAt: old.dueAt } });
      } else if (delta.greaterThan(0)) {
        const a = invoiceAmounts(delta, settings);
        await tx.invoice.create({ data: { invoiceNumber: await nextCode(tx, 'invoice'), bookingId: adj.bookingId, companyId: booking.companyId, freightAmount: a.freight, platformFee: a.platformFee, gstPercent: settings.gstPercent, gstAmount: a.gst, totalAmount: a.total, dueAt: new Date() } });
      }
      const com = await tx.bookingCommission.findUnique({ where: { allocationId: adj.allocationId } });
      if (com) {
        const ratio = com.freightAmount.isZero() ? new Prisma.Decimal(0) : com.commissionAmount.dividedBy(com.freightAmount);
        const commission = round2(adj.newAmount.times(ratio));
        await tx.bookingCommission.update({ where: { id: com.id }, data: { freightAmount: adj.newAmount, commissionAmount: commission, transporterPayable: round2(adj.newAmount.minus(commission)) } });
        await tx.settlement.updateMany({ where: { allocationId: adj.allocationId, status: { not: 'SETTLED' } }, data: { amount: round2(adj.newAmount.minus(commission)) } });
      }
    }
    await audit({ action: approve ? 'freight.adjustment_approved' : 'freight.adjustment_rejected', entityType: 'freight_adjustment', entityId: id, module: 'offers', previousValue: { amount: adj.previousAmount.toNumber() }, newValue: { amount: adj.newAmount.toNumber(), approved: approve, note }, req }, tx);
  });
  ok(res, approve ? 'Correction approved and applied' : 'Correction rejected', null);
});

// ===========================================================================
// Trips, alerts and live GPS monitoring
// ===========================================================================

export const adminTripsRouter = Router();
adminTripsRouter.use(...adminAuth);

const ACTIVE: TripStatus[] = ['VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'REACHED_PICKUP', 'LOADING', 'LOADING_COMPLETED', 'IN_TRANSIT', 'REACHED_DESTINATION', 'UNLOADING_STARTED', 'UNLOADING_COMPLETED'];
const MOVING: TripStatus[] = ['IN_TRANSIT', 'REACHED_DESTINATION'];

const tripColumns: Column[] = [
  { key: 'tripCode', label: 'Trip ID', format: 'text' },
  { key: 'bookingCode', label: 'Booking ID', format: 'text' },
  { key: 'company', label: 'Company', format: 'text' },
  { key: 'transporter', label: 'Transporter', format: 'text' },
  { key: 'tanker', label: 'Tanker', format: 'text' },
  { key: 'driver', label: 'Driver', format: 'text' },
  { key: 'pickup', label: 'Pickup', format: 'text' },
  { key: 'delivery', label: 'Delivery', format: 'text' },
  { key: 'loadingDate', label: 'Loading date', format: 'date' },
  { key: 'expectedDelivery', label: 'Expected delivery', format: 'date' },
  { key: 'status', label: 'Trip status', format: 'text' },
];

/**
 * Exception detection from tracking data. Simulated trips produce alerts flagged isSimulated so they are
 * never presented as real GPS events. Open alerts are de-duplicated per trip and type.
 */
export async function scanTripAlerts() {
  const trips = await prisma.trip.findMany({
    where: { status: { in: ACTIVE } },
    include: { booking: { select: { routePolyline: true, expectedDeliveryDate: true, locations: { select: { type: true, latitude: true, longitude: true } } } }, tracking: { orderBy: { recordedAt: 'desc' }, take: 6 } },
  });
  const open = await prisma.tripAlert.findMany({ where: { resolvedAt: null, tripId: { in: trips.map((t) => t.id) } }, select: { tripId: true, type: true } });
  const has = new Set(open.map((a) => `${a.tripId}|${a.type}`));
  const raise: Prisma.TripAlertCreateManyInput[] = [];
  const add = (tripId: string, type: string, severity: string, message: string, isSimulated: boolean) => {
    if (!has.has(`${tripId}|${type}`)) {
      has.add(`${tripId}|${type}`);
      raise.push({ tripId, type, severity, message, isSimulated });
    }
  };
  const now = Date.now();
  for (const t of trips) {
    const sim = t.isSimulated;
    const expectedEnd = t.booking.expectedDeliveryDate.getTime() + 86400_000 - 5.5 * 3600_000;
    if (now > expectedEnd && !['UNLOADING_COMPLETED'].includes(t.status)) add(t.id, 'DELAYED_DELIVERY', 'HIGH', `Expected delivery date has passed (${t.tripCode})`, sim);
    if (MOVING.includes(t.status) && t.lastGpsAt && now - t.lastGpsAt.getTime() > 30 * 60_000) add(t.id, 'GPS_OFFLINE', 'MEDIUM', `No location update for ${Math.round((now - t.lastGpsAt.getTime()) / 60000)} min`, sim);
    const last = t.tracking[0];
    if (last && t.booking.routePolyline) {
      const p = { lat: last.latitude.toNumber(), lng: last.longitude.toNumber() };
      const path = decodePolyline(t.booking.routePolyline);
      const off = Math.min(...path.map((pt: LatLng) => haversineKm(pt, p)));
      if (off > 5) add(t.id, 'ROUTE_DEVIATION', 'HIGH', `${off.toFixed(1)} km away from the planned route`, sim);
      const drop = t.booking.locations.find((l) => l.type === 'DELIVERY');
      if (drop && haversineKm({ lat: drop.latitude.toNumber(), lng: drop.longitude.toNumber() }, p) < 2) add(t.id, 'GEOFENCE_ENTRY', 'LOW', 'Tanker entered the delivery geofence (2 km)', sim);
      const pick = t.booking.locations.find((l) => l.type === 'PICKUP');
      if (pick && MOVING.includes(t.status) && haversineKm({ lat: pick.latitude.toNumber(), lng: pick.longitude.toNumber() }, p) > 2 && t.tracking.some((x) => haversineKm({ lat: pick.latitude.toNumber(), lng: pick.longitude.toNumber() }, { lat: x.latitude.toNumber(), lng: x.longitude.toNumber() }) < 2)) {
        add(t.id, 'GEOFENCE_EXIT', 'LOW', 'Tanker left the pickup geofence', sim);
      }
    }
    if (MOVING.includes(t.status) && t.tracking.length >= 3) {
      const span = t.tracking[0].recordedAt.getTime() - t.tracking[t.tracking.length - 1].recordedAt.getTime();
      const moved = haversineKm({ lat: t.tracking[0].latitude.toNumber(), lng: t.tracking[0].longitude.toNumber() }, { lat: t.tracking[t.tracking.length - 1].latitude.toNumber(), lng: t.tracking[t.tracking.length - 1].longitude.toNumber() });
      if (span > 60 * 60_000 && moved < 0.3) add(t.id, 'EXTENDED_STOPPAGE', 'MEDIUM', `Stationary for ${Math.round(span / 60000)} min`, sim);
    }
  }
  if (raise.length) await prisma.tripAlert.createMany({ data: raise });
  return raise.length;
}

adminTripsRouter.get('/', can('trips', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { status: z.string().optional(), transporterId: z.string().uuid().optional(), companyId: z.string().uuid().optional(), scope: z.enum(['active', 'completed', 'all']).default('all'), delayed: z.enum(['true']).optional() });
  const scope = await companyScope(req);
  const delayedTrips = q.delayed ? (await prisma.tripAlert.findMany({ where: { type: 'DELAYED_DELIVERY', resolvedAt: null }, select: { tripId: true } })).map((a) => a.tripId) : null;
  const where: Prisma.TripWhereInput = {
    booking: { ...scope, ...(q.companyId ? { companyId: q.companyId as string } : {}) },
    ...(q.scope === 'active' ? { status: { in: ACTIVE } } : q.scope === 'completed' ? { status: { in: ['DELIVERED', 'COMPLETED'] } } : {}),
    ...(q.status ? { status: q.status as TripStatus } : {}),
    ...(q.transporterId ? { transporterId: q.transporterId as string } : {}),
    ...(delayedTrips ? { id: { in: delayedTrips } } : {}),
    ...(q.q ? { OR: [{ tripCode: insensitive(q.q) }, { booking: { bookingCode: insensitive(q.q) } }, { tanker: { registrationNumber: insensitive(q.q) } }] } : {}),
  };
  const load = async (paged: boolean) => {
    const rows = await prisma.trip.findMany({
      where,
      orderBy: orderBy(q, ['createdAt', 'updatedAt', 'status'], 'createdAt'),
      ...win(q, paged),
      include: {
        booking: { select: { id: true, bookingCode: true, loadingDate: true, expectedDeliveryDate: true, company: { select: { name: true } }, locations: { select: { type: true, city: true } } } },
        transporter: { select: { companyName: true } },
        tanker: { select: { registrationNumber: true } },
        driver: { select: { user: { select: { fullName: true } } } },
      },
    });
    const alerts = await prisma.tripAlert.groupBy({ by: ['tripId'], where: { tripId: { in: rows.map((r) => r.id) }, resolvedAt: null }, _count: { _all: true } });
    const am = new Map(alerts.map((a) => [a.tripId, a._count._all]));
    return rows.map((t) => ({
      id: t.id,
      tripCode: t.tripCode,
      bookingId: t.booking.id,
      bookingCode: t.booking.bookingCode,
      company: t.booking.company.name,
      transporter: t.transporter.companyName,
      tanker: t.tanker?.registrationNumber ?? null,
      driver: t.driver?.user.fullName ?? null,
      pickup: city(t.booking.locations, 'PICKUP'),
      delivery: city(t.booking.locations, 'DELIVERY'),
      loadingDate: t.booking.loadingDate,
      expectedDelivery: t.booking.expectedDeliveryDate,
      status: t.status,
      openAlerts: am.get(t.id) ?? 0,
      isSimulated: t.isSimulated,
    }));
  };
  await scanTripAlerts();
  const [total, rows] = await Promise.all([prisma.trip.count({ where }), load(true)]);
  await respondList(req, res, { title: 'Trips', q, columns: tripColumns, total, rows, exportRows: () => load(false), module: 'trips' });
});

adminTripsRouter.get('/alerts', can('trips', 'view'), async (req: Request, res: Response) => {
  await scanTripAlerts();
  const open = req.query.status !== 'resolved';
  const items = await prisma.tripAlert.findMany({ where: open ? { resolvedAt: null } : { resolvedAt: { not: null } }, orderBy: { detectedAt: 'desc' }, take: 300 });
  const trips = new Map((await prisma.trip.findMany({ where: { id: { in: items.map((i) => i.tripId) } }, select: { id: true, tripCode: true, booking: { select: { bookingCode: true } }, tanker: { select: { registrationNumber: true } } } })).map((t) => [t.id, t]));
  ok(res, 'Trip alerts', { items: items.map((a) => ({ ...a, trip: trips.get(a.tripId) ?? null })) });
});

adminTripsRouter.post('/alerts/:id/resolve', can('trips', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const { note } = body(req, z.object({ note: z.string().trim().min(3).max(500) }));
  const a = await prisma.tripAlert.findUnique({ where: { id } });
  if (!a || a.resolvedAt) throw AppError.notFound('Open alert not found');
  await prisma.tripAlert.update({ where: { id }, data: { resolvedAt: new Date(), resolvedById: req.admin!.userId, resolutionNote: note } });
  await audit({ action: 'trip.alert_resolved', entityType: 'trip_alert', entityId: id, module: 'trips', newValue: { type: a.type, note }, req });
  ok(res, 'Alert resolved', null);
});

adminTripsRouter.get('/:id', can('trips', 'view'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const t = await prisma.trip.findFirst({
    where: { id, booking: await companyScope(req) },
    include: {
      booking: { select: { id: true, bookingCode: true, status: true, loadingDate: true, loadingTime: true, expectedDeliveryDate: true, routePolyline: true, distanceKm: true, company: { select: { name: true, contactPhone: true } }, locations: true, statusHistory: { orderBy: { createdAt: 'asc' } } } },
      transporter: { select: { id: true, companyName: true, owner: { select: { phone: true } } } },
      tanker: { select: { id: true, registrationNumber: true, capacityKl: true } },
      driver: { select: { id: true, user: { select: { fullName: true, phone: true } } } },
      documents: { orderBy: { createdAt: 'desc' } },
      tracking: { orderBy: { recordedAt: 'asc' }, take: 2000 },
    },
  });
  if (!t) throw AppError.notFound('Trip not found');
  const [history, alerts] = await Promise.all([prisma.tripStatusHistory.findMany({ where: { tripId: id }, orderBy: { createdAt: 'asc' } }), prisma.tripAlert.findMany({ where: { tripId: id }, orderBy: { detectedAt: 'desc' } })]);
  const delayMinutes = Math.max(0, Math.round((Date.now() - (t.booking.expectedDeliveryDate.getTime() + 86400_000 - 5.5 * 3600_000)) / 60000));
  ok(res, 'Trip', { trip: t, statusHistory: history, alerts, delayMinutes: ACTIVE.includes(t.status) ? delayMinutes : 0, dataSource: t.isSimulated ? 'SIMULATED' : t.tracking.length ? 'GPS' : 'NONE' });
});

/** Authorised status correction: previous value and reason are preserved; never a silent overwrite. */
adminTripsRouter.post('/:id/correct-status', can('trips', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const { status, reason } = body(req, z.object({ status: z.enum(['SCHEDULED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'REACHED_PICKUP', 'LOADING', 'LOADING_COMPLETED', 'IN_TRANSIT', 'REACHED_DESTINATION', 'UNLOADING_STARTED', 'UNLOADING_COMPLETED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'DISPUTED']), reason: z.string().trim().min(10, 'Explain the correction').max(500) }));
  const t = await prisma.trip.findFirst({ where: { id, booking: await companyScope(req) }, include: { booking: { select: { id: true, status: true, companyId: true } } } });
  if (!t) throw AppError.notFound('Trip not found');
  if (t.status === status) throw AppError.badRequest('Trip already has this status');
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.trip.update({
      where: { id },
      data: {
        status,
        ...(status === 'DELIVERED' && !t.deliveredAt ? { deliveredAt: now } : {}),
        ...(status === 'COMPLETED' && !t.completedAt ? { completedAt: now } : {}),
        ...(status === 'LOADING' && !t.startedAt ? { startedAt: now } : {}),
      },
    });
    await tx.tripStatusHistory.create({ data: { tripId: id, fromStatus: t.status, toStatus: status, isCorrection: true, reason, actorType: req.admin!.isSuper ? 'ADMIN' : 'EMPLOYEE', actorUserId: req.admin!.userId } });
    // Mirror onto the booking when it maps 1:1 to a booking status.
    const mirror: Record<string, string> = { VEHICLE_ASSIGNED: 'VEHICLE_ASSIGNED', DRIVER_ASSIGNED: 'DRIVER_ASSIGNED', LOADING: 'LOADING', IN_TRANSIT: 'IN_TRANSIT', DELIVERED: 'DELIVERED', COMPLETED: 'COMPLETED', DISPUTED: 'DISPUTED' };
    if (mirror[status] && t.booking.status !== mirror[status]) {
      const others = await tx.trip.count({ where: { bookingId: t.bookingId, id: { not: id }, status: { notIn: ['CANCELLED'] } } });
      if (!others || status === 'DISPUTED') {
        await tx.booking.update({ where: { id: t.bookingId }, data: { status: mirror[status] as never } });
        await tx.bookingStatusHistory.create({ data: { bookingId: t.bookingId, fromStatus: t.booking.status, toStatus: mirror[status] as never, actorType: req.admin!.isSuper ? 'ADMIN' : 'EMPLOYEE', actorUserId: req.admin!.userId, note: `Status correction: ${reason.slice(0, 400)}` } });
      }
    }
    await audit({ action: 'trip.status_corrected', entityType: 'trip', entityId: id, companyId: t.booking.companyId, module: 'trips', previousValue: { status: t.status }, newValue: { status, reason }, req }, tx);
  });
  ok(res, 'Trip status corrected (previous value kept in history)', null);
});

// ---- Live GPS monitoring ----------------------------------------------------------------

export const adminTrackingRouter = Router();
adminTrackingRouter.use(...adminAuth);

adminTrackingRouter.get('/', can('tracking', 'view'), async (req: Request, res: Response) => {
  const q = z.object({ transporterId: z.string().uuid().optional(), city: z.string().max(80).optional(), status: z.string().optional(), q: z.string().max(40).optional() }).parse(req.query);
  await scanTripAlerts();
  const trips = await prisma.trip.findMany({
    where: {
      status: q.status ? (q.status as TripStatus) : { in: ACTIVE },
      booking: { ...(await companyScope(req)), ...(q.city ? { locations: { some: { city: insensitive(q.city) } } } : {}) },
      ...(q.transporterId ? { transporterId: q.transporterId } : {}),
      ...(q.q ? { tanker: { registrationNumber: insensitive(q.q) } } : {}),
    },
    include: {
      booking: { select: { id: true, bookingCode: true, routePolyline: true, company: { select: { name: true } }, locations: { select: { type: true, city: true, latitude: true, longitude: true } } } },
      transporter: { select: { id: true, companyName: true } },
      tanker: { select: { registrationNumber: true } },
      driver: { select: { user: { select: { fullName: true, phone: true } } } },
    },
    take: 300,
  });
  const alerts = await prisma.tripAlert.findMany({ where: { tripId: { in: trips.map((t) => t.id) }, resolvedAt: null }, orderBy: { detectedAt: 'desc' } });
  ok(res, 'Live monitoring', {
    trips: trips.map((t) => ({
      id: t.id,
      tripCode: t.tripCode,
      status: t.status,
      bookingId: t.booking.id,
      bookingCode: t.booking.bookingCode,
      company: t.booking.company.name,
      transporter: t.transporter.companyName,
      tanker: t.tanker?.registrationNumber ?? null,
      driver: t.driver?.user.fullName ?? null,
      driverPhone: t.driver?.user.phone ?? null,
      pickup: t.booking.locations.find((l) => l.type === 'PICKUP') ?? null,
      delivery: t.booking.locations.find((l) => l.type === 'DELIVERY') ?? null,
      polyline: t.booking.routePolyline,
      position: t.lastLatitude && t.lastLongitude ? { lat: t.lastLatitude.toNumber(), lng: t.lastLongitude.toNumber() } : null,
      lastGpsAt: t.lastGpsAt,
      etaAt: t.etaAt,
      distanceTravelledKm: t.distanceTravelledKm.toNumber(),
      plannedDistanceKm: t.plannedDistanceKm.toNumber(),
      isSimulated: t.isSimulated,
      alerts: alerts.filter((a) => a.tripId === t.id),
    })),
    sourceNote: 'Positions marked SIMULATED come from the demo simulator, not from a GPS device. Live GPS activates when a verified tracking source (driver app / GPS device) is connected.',
  });
});

/** Emergency alerts come from the driver app / panic button in future; the demo can raise a SIMULATED one. */
adminTrackingRouter.post('/:id/emergency', can('tracking', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const t = await prisma.trip.findUnique({ where: { id }, select: { id: true, isSimulated: true, tripCode: true } });
  if (!t) throw AppError.notFound('Trip not found');
  if (!t.isSimulated && !hasPermission(req, 'tracking', 'edit')) throw AppError.forbidden();
  const { message } = body(req, z.object({ message: z.string().trim().min(3).max(300) }));
  const a = await prisma.tripAlert.create({ data: { tripId: id, type: 'EMERGENCY', severity: 'CRITICAL', message: t.isSimulated ? `[SIMULATED] ${message}` : message, isSimulated: t.isSimulated } });
  await audit({ action: 'trip.emergency_raised', entityType: 'trip', entityId: id, module: 'tracking', newValue: { message, simulated: t.isSimulated }, req });
  created(res, 'Emergency alert raised', { alert: a });
});
