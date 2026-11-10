import { Prisma, type OfferStatus } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { round2 } from '../../lib/money';
import { prisma } from '../../lib/prisma';
import { emitToTransporter } from '../../lib/realtime';
import { authenticateUser } from '../../middleware/auth';
import { requireTransporter, transporterCallerOnly } from '../../middleware/transporter';
import { validateRequest } from '../../middleware/validate';
import { AppError, ErrorCode } from '../../utils/errors';
import { created, ok } from '../../utils/response';
import { audit } from '../audit/audit';
import { OPEN_FOR_OFFERS, todayIst } from '../bookings/booking.common';
import { notifyTransporter } from '../notifications/notification.service';
import { expireStaleOffers, submitTransporterOffer, transporterRespond } from '../offers/offer.service';
import { getSettings } from '../settings/settings.service';
import { idParam, parsePaging, tid, uid, pageOf } from './common';
import { approxKmFromTanker, bookingWindow, compatible, fleetForMatching } from './matching.service';

const bookingInclude = {
  product: { select: { id: true, name: true, code: true, requiresSpecialApproval: true } },
  requirement: { include: { tankerType: { select: { name: true } } } },
  locations: { select: { type: true, address: true, city: true, state: true, latitude: true, longitude: true } },
  allocations: { where: { status: { not: 'CANCELLED' } }, select: { tankersAllocated: true } },
} satisfies Prisma.BookingInclude;

type MarketBooking = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

export interface MarketFilter {
  pickupCity?: string; deliveryCity?: string; route?: string; productId?: string; capacity?: number; minDistance?: number; maxDistance?: number;
  minOffer?: number; maxOffer?: number; from?: string; to?: string; minAvailable?: number;
}

const loadingAt = (b: MarketBooking) => new Date(`${b.loadingDate.toISOString().slice(0, 10)}T${b.loadingTime}:00+05:30`);
const remainingOf = (b: MarketBooking) => (b.requirement?.numberOfTankers ?? 1) - b.allocations.reduce((n, a) => n + a.tankersAllocated, 0);

function card(b: MarketBooking, availableTankers: number, nearestKm: number | null) {
  const p = b.locations.find((l) => l.type === 'PICKUP');
  const d = b.locations.find((l) => l.type === 'DELIVERY');
  const needed = b.requirement?.numberOfTankers ?? 1;
  return {
    id: b.id, bookingCode: b.bookingCode, status: b.status, isDemo: b.isDemo,
    pickupCity: p?.city, deliveryCity: d?.city, pickupAddress: p?.address, deliveryAddress: d?.address,
    pickup: p ? { lat: p.latitude.toNumber(), lng: p.longitude.toNumber() } : null,
    delivery: d ? { lat: d.latitude.toNumber(), lng: d.longitude.toNumber() } : null,
    distanceKm: b.distanceKm.toNumber(), durationMinutes: b.durationMinutes, routeProvider: b.routeProvider,
    product: b.product.name, productId: b.productId,
    quantityKl: b.requirement?.quantityKl.toNumber(), tankerCapacityKl: b.requirement?.tankerCapacityKl.toNumber(), tankerType: b.requirement?.tankerType?.name ?? null,
    numberOfTankers: needed, remainingTankers: remainingOf(b), loadingDate: b.loadingDate, loadingTime: b.loadingTime, expectedDeliveryDate: b.expectedDeliveryDate,
    customerOffer: b.customerOffer.toNumber(), customerOfferPerTanker: round2(b.customerOffer.dividedBy(needed)).toNumber(), offerExpiresAt: loadingAt(b),
    availableTankers, nearestTankerApproxKm: nearestKm,
  };
}

/**
 * Bookings this transporter may bid on. Everything is decided server-side: open status, not yet loaded,
 * operating area, radius, and at least one tanker verified, compatible and free for the booking's window.
 * Real and demo data never mix.
 */
export async function marketplaceBookings(transporterId: string, f: MarketFilter, take: number, skip: number) {
  const s = await getSettings();
  const agency = await prisma.agency.findUniqueOrThrow({ where: { id: transporterId }, select: { verificationStatus: true, serviceStates: true, isDemo: true } });
  if (agency.verificationStatus !== 'APPROVED') return { total: 0, items: [] as ReturnType<typeof card>[] };
  const today = new Date(`${todayIst()}T00:00:00Z`);
  const [rows, fleet] = await Promise.all([
    prisma.booking.findMany({
      where: {
        status: { in: OPEN_FOR_OFFERS }, isDemo: agency.isDemo, loadingDate: { gte: today },
        offers: { none: { transporterId } }, ignoredBy: { none: { transporterId } }, company: { status: { not: 'SUSPENDED' } },
      },
      include: bookingInclude,
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    fleetForMatching(transporterId),
  ]);
  const items: ReturnType<typeof card>[] = [];
  const statesOn = s.marketplaceMatchOperatingStates && agency.serviceStates.length > 0;
  for (const b of rows) {
    if (remainingOf(b) <= 0 || loadingAt(b).getTime() <= Date.now()) continue;
    const pickup = b.locations.find((l) => l.type === 'PICKUP');
    if (!pickup) continue;
    if (statesOn && pickup.state && !agency.serviceStates.some((x) => x.toLowerCase() === pickup.state!.toLowerCase())) continue;
    const usable = compatible(fleet, b, bookingWindow(b, s));
    if (usable.length === 0) continue;
    const dists = usable.map((t) => approxKmFromTanker(t, pickup));
    const known = dists.filter((d): d is number => d !== null);
    const nearest = known.length ? Math.min(...known) : null;
    // A fleet with no known position stays eligible: lack of GPS must not silently hide work.
    if (s.marketplaceRadiusKm > 0 && nearest !== null && nearest > s.marketplaceRadiusKm) continue;
    const c = card(b, usable.length, nearest);
    const like = (v: string | null | undefined, q?: string) => !q || (v ?? '').toLowerCase().includes(q.toLowerCase());
    if (!like(c.pickupCity, f.pickupCity) || !like(c.deliveryCity, f.deliveryCity)) continue;
    if (f.route && !like(`${c.pickupCity} ${c.deliveryCity} ${b.routeSummary ?? ''}`, f.route)) continue;
    if (f.productId && c.productId !== f.productId) continue;
    if (f.capacity !== undefined && c.tankerCapacityKl !== f.capacity) continue;
    if (f.minDistance !== undefined && c.distanceKm < f.minDistance) continue;
    if (f.maxDistance !== undefined && c.distanceKm > f.maxDistance) continue;
    if (f.minOffer !== undefined && c.customerOffer < f.minOffer) continue;
    if (f.maxOffer !== undefined && c.customerOffer > f.maxOffer) continue;
    if (f.from && b.loadingDate.toISOString().slice(0, 10) < f.from) continue;
    if (f.to && b.loadingDate.toISOString().slice(0, 10) > f.to) continue;
    if (f.minAvailable !== undefined && usable.length < f.minAvailable) continue;
    items.push(c);
  }
  return { total: items.length, items: items.slice(skip, skip + take) };
}

export const marketplaceRouter = Router();
const viewer = [authenticateUser, requireTransporter({ permission: 'agency:read' })];

const num = z.coerce.number().min(0).optional();
const filterSchema = z.object({
  pickupCity: z.string().trim().max(80).optional(), deliveryCity: z.string().trim().max(80).optional(), route: z.string().trim().max(120).optional(), productId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  capacity: num, minDistance: num, maxDistance: num, minOffer: num, maxOffer: num, minAvailable: num,
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').transform(() => undefined)), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').transform(() => undefined)),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

marketplaceRouter.get('/bookings', ...viewer, validateRequest({ query: filterSchema }), async (req: Request, res: Response) => {
  const { page, pageSize, ...f } = res.locals.query as z.infer<typeof filterSchema>;
  const result = await marketplaceBookings(tid(req), f as MarketFilter, pageSize, (page - 1) * pageSize);
  ok(res, 'Available bookings', { ...result, page, pageSize, canBid: req.transporter!.status === 'APPROVED' });
});

/** Full detail, only for a booking this transporter may see (eligible, or already negotiating). */
async function visibleBooking(transporterId: string, bookingId: string) {
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: { ...bookingInclude, company: { select: { name: true } } } });
  if (!b) throw AppError.notFound('Booking not found');
  const mine = await prisma.transporterOffer.findUnique({ where: { bookingId_transporterId: { bookingId, transporterId } }, select: { id: true } });
  if (!mine) {
    const { items } = await marketplaceBookings(transporterId, {}, 500, 0);
    if (!items.some((i) => i.id === bookingId)) throw AppError.notFound('Booking not found');
  }
  return { b, offerId: mine?.id ?? null };
}

marketplaceRouter.get('/bookings/:id', ...viewer, idParam, async (req: Request, res: Response) => {
  const { b, offerId } = await visibleBooking(tid(req), String(req.params.id));
  const s = await getSettings();
  const usable = compatible(await fleetForMatching(tid(req)), b, bookingWindow(b, s));
  const pickup = b.locations.find((l) => l.type === 'PICKUP')!;
  const nearest = usable.map((t) => approxKmFromTanker(t, pickup)).filter((d): d is number => d !== null);
  ok(res, 'Booking', {
    booking: {
      ...card(b, usable.length, nearest.length ? Math.min(...nearest) : null),
      routePolyline: b.routePolyline, routeSummary: b.routeSummary, company: b.company.name,
      specialRequirements: b.requirement?.specialRequirements ?? null, productCompatibility: b.requirement?.productCompatibility, compartmentRequirement: b.requirement?.compartmentRequirement,
      suggestedFreight: b.suggestedFreight.toNumber(), offerId,
    },
    availableTankers: usable.map((t) => ({ id: t.id, registrationNumber: t.registrationNumber, capacityKl: t.capacityKl.toNumber() })),
    limits: { minPercent: s.offerMinPercentOfSuggested, maxPercent: s.offerMaxPercentOfSuggested, maxRounds: s.maxNegotiationRounds },
  });
});

marketplaceRouter.post('/bookings/:id/ignore', authenticateUser, requireTransporter({ permission: 'agency:bids:manage' }), idParam, async (req: Request, res: Response) => {
  await visibleBooking(tid(req), String(req.params.id));
  await prisma.bookingIgnore.upsert({ where: { bookingId_transporterId: { bookingId: String(req.params.id), transporterId: tid(req) } }, update: {}, create: { bookingId: String(req.params.id), transporterId: tid(req) } });
  ok(res, 'Booking hidden', null);
});

// ---- Offers ----------------------------------------------------------------------------------

const bid = [authenticateUser, transporterCallerOnly, requireTransporter({ permission: 'agency:bids:manage', verified: true })];

const offerSchema = z
  .object({
    mode: z.enum(['ACCEPT', 'COUNTER']),
    amount: z.number().positive().max(100_000_000).optional(),
    tankers: z.number().int().min(1).max(100),
    estimatedAvailabilityAt: z.coerce.date().optional(),
    remarks: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => v.mode === 'ACCEPT' || v.amount !== undefined, { path: ['amount'], message: 'Enter your freight price' });

export const transporterBookingOffersRouter = Router();

transporterBookingOffersRouter.post('/:id/offers', ...bid, idParam, validateRequest({ body: offerSchema }), async (req: Request, res: Response) => {
  const input = req.body as z.infer<typeof offerSchema>;
  const bookingId = String(req.params.id);
  const { b } = await visibleBooking(tid(req), bookingId);
  const s = await getSettings();
  const usable = compatible(await fleetForMatching(tid(req)), b, bookingWindow(b, s));
  const remaining = remainingOf(b);
  if (input.tankers > remaining) throw AppError.badRequest(`Only ${remaining} tanker(s) are still required on this booking`, ErrorCode.OFFER_OUT_OF_RANGE);
  if (input.tankers > usable.length) throw AppError.conflict(`You have ${usable.length} compatible tanker(s) free for these dates`, ErrorCode.OFFER_NOT_ACTIONABLE);
  const needed = b.requirement?.numberOfTankers ?? 1;
  // Prices are for the tankers offered: the customer's total and the permitted range are pro-rated.
  const share = new Prisma.Decimal(input.tankers).dividedBy(needed);
  const customerShare = round2(b.customerOffer.times(share));
  const amount = input.mode === 'ACCEPT' ? customerShare : round2(input.amount!);
  const min = round2(b.suggestedFreight.times(share).times(s.offerMinPercentOfSuggested).dividedBy(100));
  const max = round2(b.suggestedFreight.times(share).times(s.offerMaxPercentOfSuggested).dividedBy(100));
  if (input.mode === 'COUNTER') {
    if (amount.equals(customerShare)) throw AppError.badRequest('That is the customer’s price. Use Accept Offer instead.', ErrorCode.OFFER_OUT_OF_RANGE);
    if (amount.lessThan(min) || amount.greaterThan(max)) throw AppError.badRequest(`Freight must be between Rs ${min.toNumber().toLocaleString('en-IN')} and Rs ${max.toNumber().toLocaleString('en-IN')}`, ErrorCode.OFFER_OUT_OF_RANGE);
  }
  const offer = await submitTransporterOffer({ transporterId: tid(req), userId: uid(req), isDemo: b.isDemo, matched: true }, bookingId, {
    amount: amount.toNumber(),
    tankersAvailable: input.tankers,
    tankerCapacityKl: Math.min(...usable.slice(0, input.tankers).map((t) => t.capacityKl.toNumber())),
    estimatedAvailabilityAt: input.estimatedAvailabilityAt ?? loadingAt(b),
    remarks: input.remarks,
    acceptsCustomerPrice: input.mode === 'ACCEPT',
  });
  await notifyTransporter(tid(req), { type: 'OFFER_SUBMITTED', title: `Offer submitted on ${b.bookingCode}`, message: `Your offer of Rs ${amount.toNumber().toLocaleString('en-IN')} is with the company.`, bookingId, link: `/transporter/offers/${offer.id}` });
  emitToTransporter(tid(req), 'offer:changed', { offerId: offer.id });
  created(res, input.mode === 'ACCEPT' ? 'Offer submitted at the customer’s price. The company will confirm.' : 'Counter-offer sent', { offerId: offer.id, status: offer.status, amount: amount.toNumber() });
});

const offerInclude = {
  history: { orderBy: { createdAt: 'asc' } },
  booking: { select: { id: true, bookingCode: true, status: true, customerOffer: true, isDemo: true, distanceKm: true, loadingDate: true, loadingTime: true, company: { select: { name: true } }, product: { select: { name: true } }, locations: { select: { type: true, city: true, address: true } }, requirement: { select: { numberOfTankers: true, tankerCapacityKl: true } } } },
} satisfies Prisma.TransporterOfferInclude;
type OfferRow = Prisma.TransporterOfferGetPayload<{ include: typeof offerInclude }>;

function shapeOffer(o: OfferRow) {
  const mine = [...o.history].reverse().find((h) => h.party === 'TRANSPORTER' && h.amount);
  const theirs = [...o.history].reverse().find((h) => h.party === 'COMPANY' && h.action === 'COUNTER_OFFER');
  return {
    id: o.id, status: o.status, round: o.round, expiresAt: o.expiresAt, tankersAvailable: o.tankersAvailable, isDemo: o.isDemo, currentAmount: o.currentAmount.toNumber(), createdAt: o.createdAt, updatedAt: o.updatedAt,
    bookingId: o.booking.id, bookingCode: o.booking.bookingCode, bookingStatus: o.booking.status, company: o.booking.company.name, product: o.booking.product.name,
    pickup: o.booking.locations.find((l) => l.type === 'PICKUP')?.city ?? null, delivery: o.booking.locations.find((l) => l.type === 'DELIVERY')?.city ?? null,
    customerOffer: theirs?.amount?.toNumber() ?? o.booking.customerOffer.toNumber(), originalCustomerOffer: o.booking.customerOffer.toNumber(), myLatestOffer: mine?.amount?.toNumber() ?? null,
    numberOfTankers: o.booking.requirement?.numberOfTankers ?? 1,
  };
}

export const transporterOffersRouter = Router();
const offerView = [authenticateUser, transporterCallerOnly, requireTransporter({ permission: 'agency:read' })];

const STATUS_TAB: Record<string, OfferStatus[] | undefined> = { all: undefined, pending: ['PENDING'], counter: ['COUNTERED'], accepted: ['ACCEPTED'], rejected: ['REJECTED', 'UNSUCCESSFUL'], expired: ['EXPIRED'], withdrawn: ['WITHDRAWN'] };

/** Mounted under /transporters/me via transporterOfferListRouter. */
export async function listMyOffers(req: Request, res: Response) {
  await expireStaleOffers();
  const q = parsePaging(req);
  const tab = String(req.query.tab ?? 'all');
  const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const where: Prisma.TransporterOfferWhereInput = { transporterId: tid(req), ...(STATUS_TAB[tab] ? { status: { in: STATUS_TAB[tab] } } : {}), ...(search ? { booking: { bookingCode: { contains: search, mode: 'insensitive' } } } : {}) };
  const [total, rows, grouped] = await Promise.all([
    prisma.transporterOffer.count({ where }),
    prisma.transporterOffer.findMany({ where, include: offerInclude, orderBy: { updatedAt: 'desc' }, ...pageOf(q) }),
    prisma.transporterOffer.groupBy({ by: ['status'], where: { transporterId: tid(req) }, _count: true }),
  ]);
  const by = (l: OfferStatus[]) => grouped.filter((g) => l.includes(g.status)).reduce((n, g) => n + g._count, 0);
  const counts = Object.fromEntries(Object.entries(STATUS_TAB).map(([k, v]) => [k, v ? by(v) : grouped.reduce((n, g) => n + g._count, 0)]));
  ok(res, 'Offers', { total, page: q.page, pageSize: q.pageSize, counts, items: rows.map(shapeOffer) });
}

transporterOffersRouter.get('/:id', ...offerView, idParam, async (req: Request, res: Response) => {
  await expireStaleOffers({});
  // Scoped to this transporter: the private thread of any other bidder is simply not found.
  const o = await prisma.transporterOffer.findFirst({ where: { id: String(req.params.id), transporterId: tid(req) }, include: offerInclude });
  if (!o) throw AppError.notFound('Offer not found');
  const s = await getSettings();
  ok(res, 'Offer', {
    offer: shapeOffer(o),
    history: o.history.map((h) => ({ id: h.id, party: h.party, action: h.action, amount: h.amount?.toNumber() ?? null, message: h.message, createdAt: h.createdAt })),
    canRespond: o.status === 'COUNTERED' && o.expiresAt > new Date(), canCounter: o.status === 'COUNTERED' && o.round < s.maxNegotiationRounds, canWithdraw: ['PENDING', 'COUNTERED'].includes(o.status),
  });
});

const respond = (action: 'ACCEPT' | 'COUNTER' | 'WITHDRAW' | 'REJECT', message: string) => async (req: Request, res: Response) => {
  const body = req.body as { amount?: number; message?: string };
  const updated = await transporterRespond({ transporterId: tid(req), userId: uid(req), isDemo: false }, String(req.params.id), { action, amount: body.amount, message: body.message });
  await audit({ action: `offer.transporter_${action.toLowerCase()}`, entityType: 'transporter_offer', entityId: updated.id, actorType: 'TRANSPORTER', actorUserId: uid(req), metadata: { amount: body.amount ?? null }, req });
  emitToTransporter(tid(req), 'offer:changed', { offerId: updated.id });
  ok(res, message, { offerId: updated.id, status: updated.status, amount: updated.currentAmount.toNumber() });
};

const noteBody = validateRequest({ body: z.object({ message: z.string().trim().max(500).optional() }).strict() });

transporterOffersRouter.post('/:id/counter', ...bid, idParam, validateRequest({ body: z.object({ amount: z.number().positive().max(100_000_000), message: z.string().trim().max(500).optional() }).strict() }), respond('COUNTER', 'Counter-offer sent'));
transporterOffersRouter.post('/:id/accept', ...bid, idParam, noteBody, respond('ACCEPT', 'You accepted the company’s counter-offer. The company will confirm.'));
transporterOffersRouter.post('/:id/reject', ...bid, idParam, noteBody, respond('REJECT', 'Counter-offer declined'));
transporterOffersRouter.post('/:id/withdraw', ...bid, idParam, noteBody, respond('WITHDRAW', 'Offer withdrawn'));
