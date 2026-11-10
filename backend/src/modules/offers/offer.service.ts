import { Prisma, type OfferStatus } from '@prisma/client';
import type { Request } from 'express';
import { nextCode } from '../../lib/codes';
import { round2 } from '../../lib/money';
import { prisma, type Tx } from '../../lib/prisma';
import { AppError, ErrorCode } from '../../utils/errors';
import { audit } from '../audit/audit';
import { lockBooking, OPEN_FOR_OFFERS, setBookingStatus } from '../bookings/booking.common';
import { notify, notifyTransporter } from '../notifications/notification.service';
import { getSettings } from '../settings/settings.service';
import { invoiceAmounts } from '../payments/payment.calc';
import { commissionForAllocation } from '../admin/commission.service';

/**
 * Offer & negotiation engine.
 *
 * Thread model: one TransporterOffer per (booking, transporter). `currentAmount` is the latest price on
 * the table and `status` says whose turn it is:
 *   PENDING   -> transporter has quoted (or accepted the customer's price); the COMPANY decides
 *   COUNTERED -> company has countered; the TRANSPORTER decides
 * Final acceptance is always done by the company, so a company can never be double-booked by several
 * transporters accepting counters at the same time. All state changes lock the booking row first.
 *
 * Company-side functions are used by the Company Portal now. Transporter-side functions are used by the
 * clearly-labelled demo simulator in Phase 1 and will back the Transporter Portal later.
 */

const OPEN: OfferStatus[] = ['PENDING', 'COUNTERED'];

const transporterSelect = {
  id: true,
  companyName: true,
  city: true,
  state: true,
  rating: true,
  completedTrips: true,
  verificationStatus: true,
  isDemo: true,
} satisfies Prisma.AgencySelect;

export const offerInclude = {
  transporter: { select: transporterSelect },
  history: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.TransporterOfferInclude;

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

/** Marks open offers past their expiry as EXPIRED (with history). Safe to call often. */
export async function expireStaleOffers(scope: { bookingId?: string } = {}): Promise<number> {
  const stale = await prisma.transporterOffer.findMany({
    where: { status: { in: OPEN }, expiresAt: { lt: new Date() }, ...(scope.bookingId ? { bookingId: scope.bookingId } : {}) },
    select: { id: true, bookingId: true, isDemo: true, booking: { select: { companyId: true, bookingCode: true } }, transporter: { select: { companyName: true } } },
    take: 200,
  });
  let expired = 0;
  for (const o of stale) {
    const done = await prisma.$transaction(async (tx) => {
      const r = await tx.transporterOffer.updateMany({
        where: { id: o.id, status: { in: OPEN }, expiresAt: { lt: new Date() } },
        data: { status: 'EXPIRED', closedAt: new Date(), version: { increment: 1 } },
      });
      if (r.count !== 1) return false;
      await tx.offerNegotiationHistory.create({ data: { offerId: o.id, bookingId: o.bookingId, party: 'SYSTEM', action: 'EXPIRED', message: 'Offer validity ended', isDemo: o.isDemo } });
      await reopenIfNoOpenOffers(tx, o.bookingId);
      return true;
    });
    if (done) {
      expired++;
      await notify({
        companyId: o.booking.companyId,
        type: 'OFFER_EXPIRED',
        title: `Offer expired on ${o.booking.bookingCode}`,
        message: `The offer from ${o.transporter.companyName} has expired.`,
        bookingId: o.bookingId,
        link: `/company/bookings/${o.bookingId}/offers`,
      });
    }
  }
  return expired;
}

/** When the last open offer closes, the booking goes back to SEARCHING (it is still open for offers). */
async function reopenIfNoOpenOffers(tx: Tx, bookingId: string) {
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { id: true, status: true } });
  if (!['OFFERS_RECEIVED', 'NEGOTIATION'].includes(booking.status)) return;
  const open = await tx.transporterOffer.count({ where: { bookingId, status: { in: OPEN } } });
  if (open === 0) await setBookingStatus(tx, booking, 'SEARCHING', { type: 'SYSTEM', note: 'No open offers remaining' });
}

// ---------------------------------------------------------------------------
// Company side
// ---------------------------------------------------------------------------

export async function listBookingOffers(companyId: string, bookingId: string) {
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, companyId }, select: { id: true } });
  if (!booking) throw AppError.notFound('Booking not found');
  await expireStaleOffers({ bookingId });
  return prisma.transporterOffer.findMany({
    where: { bookingId },
    include: offerInclude,
    orderBy: [{ status: 'asc' }, { currentAmount: 'asc' }],
  });
}

/** All offers across the company's bookings (Transporter Offers page). */
export async function listCompanyOffers(companyId: string, filter: { status?: 'open' | 'closed' | 'all' }) {
  await expireStaleOffers();
  const statusFilter =
    filter.status === 'open' ? { in: OPEN } : filter.status === 'closed' ? { notIn: OPEN } : undefined;
  return prisma.transporterOffer.findMany({
    where: { booking: { companyId }, ...(statusFilter ? { status: statusFilter } : {}) },
    include: {
      transporter: { select: transporterSelect },
      history: { orderBy: { createdAt: 'asc' } },
      booking: {
        select: {
          id: true, bookingCode: true, status: true, customerOffer: true, suggestedFreight: true, isDemo: true,
          product: { select: { name: true } },
          locations: { select: { type: true, city: true, address: true } },
          requirement: { select: { tankerCapacityKl: true, numberOfTankers: true } },
          allocations: { where: { status: { not: 'CANCELLED' } }, select: { tankersAllocated: true } },
        },
      },
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: 200,
  });
}

export async function getOffer(companyId: string, offerId: string) {
  const offer = await prisma.transporterOffer.findFirst({
    where: { id: offerId, booking: { companyId } },
    include: { ...offerInclude, booking: { select: { id: true, bookingCode: true, status: true, customerOffer: true, suggestedFreight: true } } },
  });
  if (!offer) throw AppError.notFound('Offer not found');
  return offer;
}

async function loadOfferForCompany(tx: Tx, companyId: string, offerId: string) {
  const ref = await tx.transporterOffer.findFirst({ where: { id: offerId, booking: { companyId } }, select: { bookingId: true } });
  if (!ref) throw AppError.notFound('Offer not found');
  const booking = await lockBooking(tx, ref.bookingId, companyId);
  const offer = await tx.transporterOffer.findUniqueOrThrow({ where: { id: offerId }, include: { transporter: { select: transporterSelect } } });
  return { booking, offer };
}

function assertActionable(offer: { status: OfferStatus; expiresAt: Date }, expected: OfferStatus) {
  if (offer.status === 'PENDING' || offer.status === 'COUNTERED') {
    if (offer.expiresAt.getTime() <= Date.now()) throw AppError.conflict('This offer has expired', ErrorCode.OFFER_EXPIRED);
    if (offer.status !== expected) {
      throw AppError.conflict(
        expected === 'PENDING' ? 'Waiting for the transporter to respond to your counter-offer' : 'This offer is awaiting your response',
        ErrorCode.OFFER_NOT_ACTIONABLE,
      );
    }
    return;
  }
  throw AppError.conflict(`This offer is already ${offer.status.toLowerCase()}`, ErrorCode.OFFER_NOT_ACTIONABLE);
}

export async function counterOffer(companyId: string, userId: string, offerId: string, input: { amount: number; message?: string }, req?: Request) {
  const settings = await getSettings();
  let counterNotice: { transporterId: string; bookingCode: string; bookingId: string; amount: number } | null = null;
  const result = await prisma.$transaction(async (tx) => {
    const { booking, offer } = await loadOfferForCompany(tx, companyId, offerId);
    if (!OPEN_FOR_OFFERS.includes(booking.status)) throw AppError.conflict('This booking is no longer open for negotiation', ErrorCode.INVALID_STATE_TRANSITION);
    counterNotice = { transporterId: offer.transporterId, bookingCode: booking.bookingCode, bookingId: booking.id, amount: input.amount };
    assertActionable(offer, 'PENDING');
    if (offer.round >= settings.maxNegotiationRounds) {
      throw AppError.conflict(`Negotiation limit of ${settings.maxNegotiationRounds} rounds reached. Accept or reject this offer.`, ErrorCode.OFFER_NOT_ACTIONABLE);
    }
    const amount = round2(input.amount);
    if (!amount.lessThan(offer.currentAmount)) {
      throw AppError.badRequest('Your counter-offer must be lower than the transporter’s current price', ErrorCode.OFFER_OUT_OF_RANGE);
    }
    const min = round2(booking.suggestedFreight.times(settings.offerMinPercentOfSuggested).dividedBy(100));
    if (amount.lessThan(min)) {
      throw AppError.badRequest(`Counter-offer cannot be below Rs ${min.toNumber().toLocaleString('en-IN')}`, ErrorCode.OFFER_OUT_OF_RANGE);
    }
    const updated = await tx.transporterOffer.updateMany({
      where: { id: offer.id, version: offer.version, status: 'PENDING' },
      data: {
        status: 'COUNTERED',
        currentAmount: amount,
        lastActionBy: 'COMPANY',
        round: { increment: 1 },
        expiresAt: new Date(Date.now() + settings.offerExpiryHours * 3600_000),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw AppError.conflict('This offer changed in the meantime. Reload and try again.');
    await tx.offerNegotiationHistory.create({
      data: { offerId: offer.id, bookingId: booking.id, party: 'COMPANY', action: 'COUNTER_OFFER', amount, message: input.message, actorUserId: userId, isDemo: offer.isDemo },
    });
    if (booking.status !== 'NEGOTIATION') await setBookingStatus(tx, booking, 'NEGOTIATION', { type: 'COMPANY', userId, note: `Counter-offer to ${offer.transporter.companyName}` });
    await audit({ action: 'offer.countered', entityType: 'transporter_offer', entityId: offer.id, companyId, actorUserId: userId, metadata: { amount: amount.toNumber(), previous: offer.currentAmount.toNumber() }, req }, tx);
    return offer.id;
  });
  if (counterNotice) {
    const n = counterNotice as { transporterId: string; bookingCode: string; bookingId: string; amount: number };
    await notifyTransporter(n.transporterId, { type: 'COUNTER_OFFER_RECEIVED', title: `Counter-offer on ${n.bookingCode}`, message: `The company proposed Rs ${n.amount.toLocaleString('en-IN')}. Accept or counter before it expires.`, bookingId: n.bookingId, link: `/transporter/offers/${result}` });
  }
  return getOffer(companyId, result);
}

export async function rejectOffer(companyId: string, userId: string, offerId: string, input: { reason?: string }, req?: Request) {
  const notice = await prisma.$transaction(async (tx) => {
    const { booking, offer } = await loadOfferForCompany(tx, companyId, offerId);
    if (!OPEN.includes(offer.status)) throw AppError.conflict(`This offer is already ${offer.status.toLowerCase()}`, ErrorCode.OFFER_NOT_ACTIONABLE);
    const updated = await tx.transporterOffer.updateMany({
      where: { id: offer.id, version: offer.version, status: { in: OPEN } },
      data: { status: 'REJECTED', closedAt: new Date(), lastActionBy: 'COMPANY', version: { increment: 1 } },
    });
    if (updated.count !== 1) throw AppError.conflict('This offer changed in the meantime. Reload and try again.');
    await tx.offerNegotiationHistory.create({
      data: { offerId: offer.id, bookingId: booking.id, party: 'COMPANY', action: 'REJECTED', message: input.reason, actorUserId: userId, isDemo: offer.isDemo },
    });
    await reopenIfNoOpenOffers(tx, booking.id);
    await audit({ action: 'offer.rejected', entityType: 'transporter_offer', entityId: offer.id, companyId, actorUserId: userId, metadata: { reason: input.reason ?? null }, req }, tx);
    return { transporterId: offer.transporterId, bookingCode: booking.bookingCode, bookingId: booking.id };
  });
  await notifyTransporter(notice.transporterId, { type: 'OFFER_REJECTED', title: `Offer rejected on ${notice.bookingCode}`, message: input.reason ? `The company rejected your offer: ${input.reason}` : 'The company rejected your offer.', bookingId: notice.bookingId, link: `/transporter/offers/${offerId}` });
  return getOffer(companyId, offerId);
}

/** Tankers already allocated (non-cancelled) on a booking. */
export async function allocatedTankers(tx: Tx, bookingId: string): Promise<number> {
  const agg = await tx.bookingAllocation.aggregate({ where: { bookingId, status: { not: 'CANCELLED' } }, _sum: { tankersAllocated: true } });
  return agg._sum.tankersAllocated ?? 0;
}

/**
 * Accepts a transporter's current price for one tanker allocation. Runs in one transaction under the
 * booking row lock:
 *  - allocates min(tankers offered, tankers still unallocated) to this transporter (partial fulfilment);
 *    the agreed freight is pro-rated when the offer covers more tankers than remain;
 *  - locks the agreed price, creates the allocation, one scheduled trip per tanker and a freight invoice;
 *  - when every tanker is allocated the booking becomes CONFIRMED and all other open offers are closed as
 *    UNSUCCESSFUL; otherwise the booking stays open (NEGOTIATION) for the remaining tankers.
 * An offer can be accepted once (unique allocation per offer + version check), and the sum of allocated
 * tankers can never exceed the requirement, so double booking is impossible even under concurrency.
 */
export async function acceptOffer(companyId: string, userId: string, offerId: string, req?: Request) {
  const settings = await getSettings();
  const outcome = await prisma.$transaction(async (tx) => {
    const { booking, offer } = await loadOfferForCompany(tx, companyId, offerId);
    if (!OPEN_FOR_OFFERS.includes(booking.status)) {
      throw AppError.conflict(
        booking.status === 'CANCELLED' ? 'This booking was cancelled' : 'This booking is already confirmed with a transporter',
        ErrorCode.BOOKING_ALREADY_CONFIRMED,
      );
    }
    assertActionable(offer, 'PENDING');
    const needed = booking.requirement?.numberOfTankers ?? 1;
    const remaining = needed - (await allocatedTankers(tx, booking.id));
    if (remaining <= 0) throw AppError.conflict('All tankers for this booking are already allocated', ErrorCode.BOOKING_ALREADY_CONFIRMED);
    const tankers = Math.min(offer.tankersAvailable, remaining);
    const agreed = tankers === offer.tankersAvailable ? offer.currentAmount : round2(offer.currentAmount.times(tankers).dividedBy(offer.tankersAvailable));
    const fullyAllocated = tankers === remaining;
    const now = new Date();

    const won = await tx.transporterOffer.updateMany({
      where: { id: offer.id, version: offer.version, status: 'PENDING' },
      data: { status: 'ACCEPTED', closedAt: now, lastActionBy: 'COMPANY', version: { increment: 1 } },
    });
    if (won.count !== 1) throw AppError.conflict('This offer changed in the meantime. Reload and try again.');
    await tx.offerNegotiationHistory.create({
      data: {
        offerId: offer.id,
        bookingId: booking.id,
        party: 'COMPANY',
        action: 'ACCEPTED',
        amount: agreed,
        message: needed > 1 ? `${tankers} of ${needed} tanker(s) allocated` : null,
        actorUserId: userId,
        isDemo: offer.isDemo,
      },
    });

    let closedOthers = 0;
    if (fullyAllocated) {
      const others = await tx.transporterOffer.findMany({ where: { bookingId: booking.id, id: { not: offer.id }, status: { in: OPEN } }, select: { id: true, isDemo: true } });
      closedOthers = others.length;
      if (others.length) {
        await tx.transporterOffer.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: 'UNSUCCESSFUL', closedAt: now, version: { increment: 1 } } });
        await tx.offerNegotiationHistory.createMany({
          data: others.map((o) => ({ offerId: o.id, bookingId: booking.id, party: 'SYSTEM' as const, action: 'CLOSED' as const, message: 'All tankers allocated to other transporters', isDemo: o.isDemo })),
        });
      }
    }

    const allocation = await tx.bookingAllocation.create({
      data: { bookingId: booking.id, offerId: offer.id, transporterId: offer.transporterId, tankersAllocated: tankers, agreedFreight: agreed },
    });
    for (let i = 0; i < tankers; i++) {
      await tx.trip.create({
        data: {
          tripCode: await nextCode(tx, 'trip'),
          allocationId: allocation.id,
          bookingId: booking.id,
          transporterId: offer.transporterId,
          plannedDistanceKm: booking.distanceKm,
          isSimulated: offer.isDemo,
        },
      });
    }
    // Platform commission + pending transporter settlement for this allocation.
    await commissionForAllocation(allocation.id, tx);
    const amounts = invoiceAmounts(agreed, settings);
    await tx.invoice.create({
      data: {
        invoiceNumber: await nextCode(tx, 'invoice'),
        bookingId: booking.id,
        companyId,
        freightAmount: amounts.freight,
        platformFee: amounts.platformFee,
        gstPercent: new Prisma.Decimal(settings.gstPercent),
        gstAmount: amounts.gst,
        totalAmount: amounts.total,
        dueAt: booking.loadingDate,
      },
    });

    const agg = await tx.bookingAllocation.aggregate({ where: { bookingId: booking.id, status: { not: 'CANCELLED' } }, _sum: { agreedFreight: true } });
    if (fullyAllocated) {
      await setBookingStatus(tx, booking, 'CONFIRMED', { type: 'COMPANY', userId, note: needed > 1 ? `All ${needed} tankers allocated` : `Confirmed with ${offer.transporter.companyName}` }, {
        acceptedFreight: agg._sum.agreedFreight,
        confirmedAt: now,
      });
    } else {
      await setBookingStatus(tx, booking, 'NEGOTIATION', { type: 'COMPANY', userId, note: `${tankers} tanker(s) allocated to ${offer.transporter.companyName}; ${remaining - tankers} remaining` });
    }
    await audit(
      {
        action: 'offer.accepted',
        entityType: 'transporter_offer',
        entityId: offer.id,
        companyId,
        actorUserId: userId,
        metadata: { bookingId: booking.id, agreedFreight: agreed.toNumber(), tankers, remaining: remaining - tankers, closedOthers },
        req,
      },
      tx,
    );
    return {
      transporterId: offer.transporterId,
      losers: fullyAllocated ? (await tx.transporterOffer.findMany({ where: { bookingId: booking.id, status: 'UNSUCCESSFUL', closedAt: now }, select: { transporterId: true, id: true } })) : [],
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      transporter: offer.transporter.companyName,
      amount: agreed,
      total: amounts.total,
      tankersAllocated: tankers,
      tankersRemaining: remaining - tankers,
      confirmed: fullyAllocated,
    };
  });

  const price = `Rs ${outcome.amount.toNumber().toLocaleString('en-IN')}`;
  await notifyTransporter(outcome.transporterId, { type: 'BOOKING_CONFIRMED', title: `Booking ${outcome.bookingCode} confirmed`, message: `The company accepted your offer for ${outcome.tankersAllocated} tanker(s) at ${price}. Assign your tanker and driver.`, bookingId: outcome.bookingId, link: '/transporter/bookings' });
  for (const l of outcome.losers) {
    await notifyTransporter(l.transporterId, { type: 'OFFER_REJECTED', title: `${outcome.bookingCode} was awarded elsewhere`, message: 'All tankers on this booking are now allocated, so your offer has closed.', bookingId: outcome.bookingId, link: `/transporter/offers/${l.id}` });
  }
  if (outcome.confirmed) {
    await notify({
      companyId,
      type: 'BOOKING_CONFIRMED',
      title: `Booking ${outcome.bookingCode} confirmed`,
      message: `${outcome.transporter} will transport ${outcome.tankersAllocated} tanker(s) for ${price}. Every tanker on this booking is now allocated; freight invoice issued.`,
      bookingId: outcome.bookingId,
      link: `/company/bookings/${outcome.bookingId}/confirmation`,
    });
  } else {
    await notify({
      companyId,
      type: 'OFFER_ACCEPTED',
      title: `Offer accepted on ${outcome.bookingCode}`,
      message: `${outcome.transporter} allocated ${outcome.tankersAllocated} tanker(s) for ${price}. ${outcome.tankersRemaining} tanker(s) still need a transporter.`,
      bookingId: outcome.bookingId,
      link: `/company/bookings/${outcome.bookingId}/offers`,
    });
  }
  await notify({
    companyId,
    type: 'PAYMENT_PENDING',
    title: `Invoice issued for ${outcome.bookingCode}`,
    message: `Rs ${outcome.total.toNumber().toLocaleString('en-IN')} (freight, platform fee and GST) for this allocation. Pay the advance from Payments.`,
    bookingId: outcome.bookingId,
    link: `/company/payments?booking=${outcome.bookingId}`,
  });
  return outcome;
}

// ---------------------------------------------------------------------------
// Transporter side (demo simulator now, Transporter Portal later)
// ---------------------------------------------------------------------------

export interface TransporterActor {
  transporterId: string;
  userId?: string | null;
  isDemo: boolean;
  /** The Transporter Portal has already run date-aware matching (marketplace.service) inside its own checks. */
  matched?: boolean;
}

/** Transporters that have an available tanker able to carry this product at this capacity. */
export async function eligibleTransporters(bookingId: string, opts: { demoOnly?: boolean } = {}) {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { requirement: true } });
  const req = booking.requirement!;
  return prisma.agency.findMany({
    where: {
      verificationStatus: 'APPROVED',
      ...(opts.demoOnly ? { isDemo: true } : {}),
      tankers: {
        some: {
          status: 'AVAILABLE',
          capacityKl: { gte: req.tankerCapacityKl },
          products: { some: { productId: booking.productId } },
          ...(req.tankerTypeId ? { tankerTypeId: req.tankerTypeId } : {}),
          ...(req.compartmentRequirement === 'MULTI' ? { compartments: { gte: 2 } } : req.compartmentRequirement === 'SINGLE' ? { compartments: 1 } : {}),
        },
      },
    },
    include: {
      tankers: {
        where: { status: 'AVAILABLE', capacityKl: { gte: req.tankerCapacityKl }, products: { some: { productId: booking.productId } } },
        select: { id: true, capacityKl: true },
      },
    },
  });
}

export async function submitTransporterOffer(
  actor: TransporterActor,
  bookingId: string,
  input: { amount: number; tankersAvailable: number; tankerCapacityKl: number; estimatedAvailabilityAt: Date; remarks?: string; acceptsCustomerPrice?: boolean },
) {
  const settings = await getSettings();
  const out = await prisma.$transaction(async (tx) => {
    const booking = await lockBooking(tx, bookingId);
    if (!OPEN_FOR_OFFERS.includes(booking.status)) throw AppError.conflict('Booking is not open for offers', ErrorCode.INVALID_STATE_TRANSITION);
    const eligible = actor.matched || (await eligibleTransporters(bookingId)).some((t) => t.id === actor.transporterId);
    if (!eligible) throw AppError.forbidden('Transporter has no compatible tanker for this booking');
    const existing = await tx.transporterOffer.findUnique({ where: { bookingId_transporterId: { bookingId, transporterId: actor.transporterId } } });
    if (existing) throw AppError.conflict('An offer from this transporter already exists for this booking');
    const amount = round2(input.amount);
    const acceptsCustomerPrice = input.acceptsCustomerPrice ?? amount.equals(booking.customerOffer);
    const offer = await tx.transporterOffer.create({
      data: {
        bookingId,
        transporterId: actor.transporterId,
        status: 'PENDING',
        initialAmount: amount,
        currentAmount: amount,
        lastActionBy: 'TRANSPORTER',
        tankersAvailable: input.tankersAvailable,
        tankerCapacityKl: input.tankerCapacityKl,
        estimatedAvailabilityAt: input.estimatedAvailabilityAt,
        remarks: input.remarks,
        expiresAt: new Date(Date.now() + settings.offerExpiryHours * 3600_000),
        submittedById: actor.userId ?? null,
        isDemo: actor.isDemo,
        history: {
          create: {
            bookingId,
            party: 'TRANSPORTER',
            action: acceptsCustomerPrice ? 'CUSTOMER_PRICE_ACCEPTED' : 'OFFER_SUBMITTED',
            amount,
            message: input.remarks,
            actorUserId: actor.userId ?? null,
            isDemo: actor.isDemo,
          },
        },
      },
      include: { transporter: { select: { companyName: true } } },
    });
    if (booking.status === 'SEARCHING') await setBookingStatus(tx, booking, 'OFFERS_RECEIVED', { type: 'TRANSPORTER', note: 'First offer received' });
    await audit({ action: 'offer.submitted', entityType: 'transporter_offer', entityId: offer.id, companyId: booking.companyId, actorType: 'TRANSPORTER', actorUserId: actor.userId, metadata: { amount: amount.toNumber(), demo: actor.isDemo } }, tx);
    return { offer, booking, acceptsCustomerPrice };
  });
  await notify({
    companyId: out.booking.companyId,
    type: 'OFFER_RECEIVED',
    title: `${out.acceptsCustomerPrice ? 'Your price accepted' : 'New offer'} on ${out.booking.bookingCode}${out.offer.isDemo ? ' (demo)' : ''}`,
    message: `${out.offer.transporter.companyName} ${out.acceptsCustomerPrice ? 'accepted your price of' : 'offered'} Rs ${out.offer.currentAmount.toNumber().toLocaleString('en-IN')}.`,
    bookingId,
    link: `/company/bookings/${bookingId}/offers`,
  });
  return out.offer;
}

/** Transporter responds to the company's counter: accept the counter price, or counter again. */
export async function transporterRespond(actor: TransporterActor, offerId: string, input: { action: 'ACCEPT' | 'COUNTER' | 'WITHDRAW' | 'REJECT'; amount?: number; message?: string }) {
  const settings = await getSettings();
  const out = await prisma.$transaction(async (tx) => {
    const ref = await tx.transporterOffer.findFirst({ where: { id: offerId, transporterId: actor.transporterId }, select: { bookingId: true } });
    // Only the transporter that owns the offer may modify it.
    if (!ref) throw AppError.notFound('Offer not found');
    const booking = await lockBooking(tx, ref.bookingId);
    const offer = await tx.transporterOffer.findUniqueOrThrow({ where: { id: offerId }, include: { transporter: { select: { companyName: true } } } });
    if (!OPEN_FOR_OFFERS.includes(booking.status)) throw AppError.conflict('Booking is no longer open', ErrorCode.INVALID_STATE_TRANSITION);

    if (input.action === 'WITHDRAW') {
      if (!OPEN.includes(offer.status)) throw AppError.conflict('Offer is not open', ErrorCode.OFFER_NOT_ACTIONABLE);
      await tx.transporterOffer.update({ where: { id: offerId }, data: { status: 'WITHDRAWN', closedAt: new Date(), lastActionBy: 'TRANSPORTER', version: { increment: 1 } } });
      await tx.offerNegotiationHistory.create({ data: { offerId, bookingId: booking.id, party: 'TRANSPORTER', action: 'WITHDRAWN', message: input.message, actorUserId: actor.userId ?? null, isDemo: offer.isDemo } });
      await reopenIfNoOpenOffers(tx, booking.id);
      return { booking, offer, kind: 'WITHDRAWN' as const, amount: offer.currentAmount };
    }

    assertActionable(offer, 'COUNTERED');
    if (input.action === 'REJECT') {
      const closed = await tx.transporterOffer.updateMany({ where: { id: offerId, version: offer.version, status: 'COUNTERED' }, data: { status: 'REJECTED', closedAt: new Date(), lastActionBy: 'TRANSPORTER', version: { increment: 1 } } });
      if (closed.count !== 1) throw AppError.conflict('Offer changed in the meantime');
      await tx.offerNegotiationHistory.create({ data: { offerId, bookingId: booking.id, party: 'TRANSPORTER', action: 'REJECTED', message: input.message, actorUserId: actor.userId ?? null, isDemo: offer.isDemo } });
      await reopenIfNoOpenOffers(tx, booking.id);
      return { booking, offer, kind: 'REJECT' as const, amount: offer.currentAmount };
    }
    let amount = offer.currentAmount;
    if (input.action === 'COUNTER') {
      if (input.amount === undefined) throw AppError.badRequest('Counter amount is required');
      amount = round2(input.amount);
      if (!amount.greaterThan(offer.currentAmount)) throw AppError.badRequest('A transporter counter must be above the company’s counter-offer');
      if (offer.round >= settings.maxNegotiationRounds) throw AppError.conflict('Negotiation round limit reached', ErrorCode.OFFER_NOT_ACTIONABLE);
    }
    const updated = await tx.transporterOffer.updateMany({
      where: { id: offerId, version: offer.version, status: 'COUNTERED' },
      data: {
        status: 'PENDING',
        currentAmount: amount,
        lastActionBy: 'TRANSPORTER',
        expiresAt: new Date(Date.now() + settings.offerExpiryHours * 3600_000),
        version: { increment: 1 },
        ...(input.action === 'COUNTER' ? { round: { increment: 1 } } : {}),
      },
    });
    if (updated.count !== 1) throw AppError.conflict('Offer changed in the meantime');
    await tx.offerNegotiationHistory.create({
      data: {
        offerId,
        bookingId: booking.id,
        party: 'TRANSPORTER',
        action: input.action === 'ACCEPT' ? 'CUSTOMER_PRICE_ACCEPTED' : 'COUNTER_OFFER',
        amount,
        message: input.message,
        actorUserId: actor.userId ?? null,
        isDemo: offer.isDemo,
      },
    });
    return { booking, offer, kind: input.action, amount };
  });

  const price = `Rs ${out.amount.toNumber().toLocaleString('en-IN')}`;
  const demo = out.offer.isDemo ? ' (demo)' : '';
  if (out.kind === 'REJECT' || out.kind === 'WITHDRAWN') {
    await notify({
      companyId: out.booking.companyId,
      type: 'OFFER_EXPIRED',
      title: `Offer ${out.kind === 'REJECT' ? 'declined' : 'withdrawn'} on ${out.booking.bookingCode}${demo}`,
      message: `${out.offer.transporter.companyName} ${out.kind === 'REJECT' ? 'declined your counter-offer' : 'withdrew its offer'}.`,
      bookingId: out.booking.id,
      link: `/company/bookings/${out.booking.id}/offers`,
    });
  } else if (out.kind === 'ACCEPT') {
    await notify({
      companyId: out.booking.companyId,
      type: 'COUNTER_OFFER_ACCEPTED',
      title: `Counter-offer accepted${demo}`,
      message: `${out.offer.transporter.companyName} accepted your price of ${price} for ${out.booking.bookingCode}. Confirm the booking to lock it in.`,
      bookingId: out.booking.id,
      link: `/company/bookings/${out.booking.id}/offers`,
    });
  } else if (out.kind === 'COUNTER') {
    await notify({
      companyId: out.booking.companyId,
      type: 'COUNTER_OFFER_RECEIVED',
      title: `Counter-offer received${demo}`,
      message: `${out.offer.transporter.companyName} countered with ${price} on ${out.booking.bookingCode}.`,
      bookingId: out.booking.id,
      link: `/company/bookings/${out.booking.id}/offers`,
    });
  }
  return prisma.transporterOffer.findUniqueOrThrow({ where: { id: offerId }, include: offerInclude });
}

/** Public transporter profile visible to companies. */
export async function transporterProfile(transporterId: string) {
  const t = await prisma.agency.findFirst({
    where: { id: transporterId, verificationStatus: 'APPROVED' },
    select: {
      ...transporterSelect,
      serviceStates: true,
      createdAt: true,
      tankers: {
        where: { status: { not: 'INACTIVE' } },
        select: { capacityKl: true, compartments: true, tankerType: { select: { name: true } }, products: { select: { product: { select: { name: true } } } } },
      },
      _count: { select: { tankers: true, drivers: true } },
    },
  });
  if (!t) throw AppError.notFound('Transporter not found');
  const capacities = [...new Set(t.tankers.map((k) => k.capacityKl.toNumber()))].sort((a, b) => a - b);
  const products = [...new Set(t.tankers.flatMap((k) => k.products.map((p) => p.product.name)))].sort();
  const types = [...new Set(t.tankers.map((k) => k.tankerType.name))];
  const { tankers: _tankers, ...rest } = t;
  return { ...rest, fleet: { tankers: t._count.tankers, drivers: t._count.drivers, capacities, products, tankerTypes: types } };
}
