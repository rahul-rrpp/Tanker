import type { Prisma, BookingStatus, NotificationType, TripStatus } from '@prisma/client';
import { env } from '../../config/env';
import { round2, roundTo10 } from '../../lib/money';
import { prisma } from '../../lib/prisma';
import { storage } from '../../lib/storage';
import { AppError, ErrorCode } from '../../utils/errors';
import { decodePolyline, pointAlong } from '../../utils/polyline';
import { audit } from '../audit/audit';
import { lockBooking, setBookingStatus } from '../bookings/booking.common';
import { demoDeliveryProofPdf } from '../documents/document.service';
import { notify } from '../notifications/notification.service';
import { eligibleTransporters, submitTransporterOffer, transporterRespond } from '../offers/offer.service';

/**
 * ============================================================================
 *  DEMO SIMULATOR (DEMO_MODE=true only)
 * ============================================================================
 * Stands in for the Transporter Portal, Driver app and admin back-office in Phase 1 so the company
 * workflow can be tested end-to-end. Every record it produces is flagged (isDemo / SIMULATED) and the
 * UI labels it. Only seeded demo transporters (isDemo=true) ever act through this simulator.
 */

export function assertDemo() {
  if (!env.DEMO_MODE || env.isProduction) throw new AppError(404, ErrorCode.DEMO_DISABLED, 'Demo simulator is disabled');
}

async function ownedBooking(companyId: string, bookingId: string) {
  const b = await prisma.booking.findFirst({ where: { id: bookingId, companyId }, include: { requirement: true } });
  if (!b) throw AppError.notFound('Booking not found');
  return b;
}

/** Generates 2-4 clearly-labelled demo offers from compatible demo transporters. */
export async function simulateOffers(companyId: string, bookingId: string, count = 3) {
  assertDemo();
  const booking = await ownedBooking(companyId, bookingId);
  if (!['SEARCHING', 'OFFERS_RECEIVED', 'NEGOTIATION'].includes(booking.status)) {
    throw AppError.conflict('This booking is not open for offers', ErrorCode.INVALID_STATE_TRANSITION);
  }
  const existing = new Set((await prisma.transporterOffer.findMany({ where: { bookingId }, select: { transporterId: true } })).map((o) => o.transporterId));
  const pool = (await eligibleTransporters(bookingId, { demoOnly: true })).filter((t) => !existing.has(t.id));
  if (pool.length === 0) {
    throw AppError.conflict('No more compatible demo transporters for this product and tanker size', ErrorCode.OFFER_NOT_ACTIONABLE);
  }
  const needed = booking.requirement!.numberOfTankers;
  // Deterministic-but-varied pricing around the customer's offer.
  const multipliers = [1, 1.06, 1.12, 0.98, 1.09];
  const created = [];
  for (const [i, t] of pool.slice(0, Math.min(count, pool.length)).entries()) {
    const m = multipliers[(existing.size + i) % multipliers.length];
    // Multi-tanker bookings: every other demo transporter can supply only part of the fleet (partial fulfilment).
    const tankers = needed > 1 && i % 2 === 1 ? Math.max(1, needed - 1) : needed;
    const perTanker = booking.customerOffer.dividedBy(needed);
    const amount = m === 1 && tankers === needed ? booking.customerOffer : roundTo10(perTanker.times(tankers).times(m));
    const loading = new Date(`${booking.loadingDate.toISOString().slice(0, 10)}T${booking.loadingTime}:00+05:30`);
    const offer = await submitTransporterOffer({ transporterId: t.id, isDemo: true }, bookingId, {
      amount: amount.toNumber(),
      tankersAvailable: tankers,
      tankerCapacityKl: t.tankers[0].capacityKl.toNumber(),
      estimatedAvailabilityAt: new Date(loading.getTime() - (i + 1) * 2 * 3600_000),
      remarks: m === 1 ? 'Demo offer: accepts your price.' : `Demo offer: ${i % 2 ? 'Experienced driver, sealed compartments.' : 'GPS-fitted tanker, ready on time.'}`,
    });
    created.push(offer);
  }
  return created;
}

/** Simulates the demo transporter's reply to a company counter-offer. */
export async function simulateTransporterResponse(companyId: string, offerId: string, action: 'ACCEPT' | 'COUNTER') {
  assertDemo();
  const offer = await prisma.transporterOffer.findFirst({
    where: { id: offerId, booking: { companyId } },
    include: { history: { where: { party: 'TRANSPORTER' }, orderBy: { createdAt: 'desc' }, take: 1 }, transporter: { select: { isDemo: true } } },
  });
  if (!offer) throw AppError.notFound('Offer not found');
  if (!offer.transporter.isDemo || !offer.isDemo) throw AppError.forbidden('Only demo transporters can be simulated');
  if (offer.status !== 'COUNTERED') throw AppError.conflict('The transporter has nothing to respond to', ErrorCode.OFFER_NOT_ACTIONABLE);
  let amount: number | undefined;
  if (action === 'COUNTER') {
    const lastTransporterPrice = offer.history[0]?.amount ?? offer.initialAmount;
    amount = roundTo10(offer.currentAmount.plus(lastTransporterPrice).dividedBy(2)).toNumber();
    if (amount <= offer.currentAmount.toNumber()) amount = offer.currentAmount.plus(10).toNumber();
  }
  return transporterRespond({ transporterId: offer.transporterId, isDemo: true }, offerId, {
    action,
    amount,
    message: action === 'ACCEPT' ? 'Demo: we accept your counter-offer.' : 'Demo: best we can do for this route.',
  });
}

/** Admin verification stand-in so a freshly registered company can be fully tested. */
export async function simulateCompanyVerification(companyId: string, userId: string) {
  assertDemo();
  const c = await prisma.company.update({ where: { id: companyId }, data: { status: 'VERIFIED', verifiedAt: new Date(), statusReason: null } });
  await prisma.companyDocument.updateMany({ where: { companyId, isCurrent: true }, data: { status: 'VERIFIED' } });
  await audit({ action: 'company.verified_demo', entityType: 'company', entityId: companyId, companyId, actorUserId: userId, actorType: 'SYSTEM', metadata: { demo: true } });
  await notify({ companyId, type: 'COMPANY_VERIFICATION_UPDATE', title: 'Company verified (demo)', message: `${c.name} has been marked as verified by the demo simulator.`, link: '/company/profile' });
  return c;
}

// ---- Trip progression -----------------------------------------------------------------------

const NEXT: Partial<Record<TripStatus, TripStatus>> = {
  SCHEDULED: 'VEHICLE_ASSIGNED',
  VEHICLE_ASSIGNED: 'DRIVER_ASSIGNED',
  DRIVER_ASSIGNED: 'LOADING',
  LOADING: 'IN_TRANSIT',
  DELIVERED: 'COMPLETED',
};

const NOTICE: Partial<Record<TripStatus, { type: NotificationType; title: string; message: (code: string, extra: string) => string }>> = {
  VEHICLE_ASSIGNED: { type: 'VEHICLE_ASSIGNED', title: 'Vehicle assigned', message: (c, x) => `Tanker ${x} assigned to ${c}.` },
  DRIVER_ASSIGNED: { type: 'DRIVER_ASSIGNED', title: 'Driver assigned', message: (c, x) => `${x} will drive for ${c}.` },
  LOADING: { type: 'LOADING_STARTED', title: 'Loading started', message: (c) => `Tanker reached the loading point and loading started for ${c}.` },
  IN_TRANSIT: { type: 'TRIP_STARTED', title: 'Trip started', message: (c) => `${c} is loaded and the trip has started.` },
  DELIVERED: { type: 'DELIVERY_COMPLETED', title: 'Delivery completed', message: (c) => `${c} has been delivered. Proof of delivery is in Documents.` },
};

const STEP_FRACTION = 0.3;

/** Advances a demo trip by one stage (or ~30% of the route while in transit), writing SIMULATED GPS. */
export async function advanceTrip(companyId: string, tripId: string) {
  assertDemo();
  const ref = await prisma.trip.findFirst({ where: { id: tripId, booking: { companyId } }, select: { bookingId: true, isSimulated: true } });
  if (!ref) throw AppError.notFound('Trip not found');
  if (!ref.isSimulated) throw AppError.forbidden('Only demo trips can be simulated');

  const result = await prisma.$transaction(async (tx) => {
    const booking = await lockBooking(tx, ref.bookingId, companyId);
    const trip = await tx.trip.findUniqueOrThrow({ where: { id: tripId } });
    if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED') throw AppError.conflict(`Trip is already ${trip.status.toLowerCase()}`, ErrorCode.INVALID_STATE_TRANSITION);
    const path = booking.routePolyline ? decodePolyline(booking.routePolyline) : [];
    const planned = trip.plannedDistanceKm.toNumber();
    const now = new Date();
    let extra = '';
    let to: TripStatus;
    const data: Prisma.TripUpdateInput = {};

    if (trip.status === 'IN_TRANSIT') {
      const done = planned > 0 ? trip.distanceTravelledKm.toNumber() / planned : 1;
      const target = Math.min(1, done + STEP_FRACTION);
      const steps = 6;
      const pts = [];
      for (let s = 1; s <= steps; s++) {
        const f = done + ((target - done) * s) / steps;
        const { point, heading } = pointAlong(path, f);
        pts.push({ tripId, latitude: Number(point.lat.toFixed(6)), longitude: Number(point.lng.toFixed(6)), heading, speedKmph: 38 + ((s * 7) % 17), source: 'SIMULATED' as const, recordedAt: new Date(now.getTime() - (steps - s) * 60_000) });
      }
      await tx.tripTracking.createMany({ data: pts });
      const last = pts[pts.length - 1];
      const remainingMin = Math.round(booking.durationMinutes * (1 - target));
      Object.assign(data, {
        distanceTravelledKm: round2(planned * target),
        lastLatitude: last.latitude,
        lastLongitude: last.longitude,
        lastGpsAt: now,
        etaAt: new Date(now.getTime() + remainingMin * 60_000),
      });
      to = target >= 1 ? 'DELIVERED' : 'IN_TRANSIT';
      if (to === 'DELIVERED') data.deliveredAt = now;
    } else {
      to = NEXT[trip.status]!;
      if (to === 'VEHICLE_ASSIGNED') {
        const tanker = await tx.tanker.findFirst({
          where: { transporterId: trip.transporterId, status: 'AVAILABLE', capacityKl: { gte: booking.requirement!.tankerCapacityKl }, products: { some: { productId: booking.productId } } },
        });
        if (!tanker) throw AppError.conflict('Demo transporter has no free compatible tanker right now');
        await tx.tanker.update({ where: { id: tanker.id }, data: { status: 'ON_TRIP' } });
        data.tanker = { connect: { id: tanker.id } };
        extra = tanker.registrationNumber;
      } else if (to === 'DRIVER_ASSIGNED') {
        const driver = await tx.driver.findFirst({
          where: { agencyId: trip.transporterId, verificationStatus: 'APPROVED', trips: { none: { status: { in: ['DRIVER_ASSIGNED', 'LOADING', 'IN_TRANSIT'] } } } },
          include: { user: { select: { fullName: true } } },
        });
        if (!driver) throw AppError.conflict('Demo transporter has no free driver right now');
        data.driver = { connect: { id: driver.id } };
        extra = driver.user.fullName;
      } else if (to === 'LOADING') {
        const start = path[0] ?? { lat: 0, lng: 0 };
        await tx.tripTracking.create({ data: { tripId, latitude: start.lat, longitude: start.lng, speedKmph: 0, heading: 0, source: 'SIMULATED', recordedAt: now } });
        Object.assign(data, { startedAt: now, lastLatitude: start.lat, lastLongitude: start.lng, lastGpsAt: now, etaAt: new Date(now.getTime() + (booking.durationMinutes + 90) * 60_000) });
      } else if (to === 'IN_TRANSIT') {
        data.loadedAt = now;
      } else if (to === 'COMPLETED') {
        data.completedAt = now;
        if (trip.tankerId) await tx.tanker.update({ where: { id: trip.tankerId }, data: { status: 'AVAILABLE' } });
        await tx.agency.update({ where: { id: trip.transporterId }, data: { completedTrips: { increment: 1 } } });
      }
    }

    await tx.trip.update({ where: { id: tripId }, data: { ...data, status: to } });
    if (to !== trip.status) {
      if (to === 'IN_TRANSIT' || to === 'VEHICLE_ASSIGNED') await tx.bookingAllocation.updateMany({ where: { id: trip.allocationId, status: 'CONFIRMED' }, data: { status: 'IN_PROGRESS' } });
      // A booking with several tankers moves forward only as far as its least-advanced trip.
      const order: TripStatus[] = ['SCHEDULED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'LOADING', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];
      const trips = await tx.trip.findMany({ where: { bookingId: booking.id, status: { not: 'CANCELLED' } }, select: { status: true } });
      const least = trips.reduce((min, t) => (order.indexOf(t.status) < order.indexOf(min) ? t.status : min), 'COMPLETED' as TripStatus);
      const target: BookingStatus = least === 'SCHEDULED' ? 'CONFIRMED' : (least as BookingStatus);
      const flow: BookingStatus[] = ['CONFIRMED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'LOADING', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];
      // Only fully-allocated (CONFIRMED or later) bookings follow trip progress.
      if (flow.includes(booking.status) && flow.indexOf(target) > flow.indexOf(booking.status)) {
        await setBookingStatus(tx, booking, target, { type: 'SYSTEM', note: `Demo simulator: ${target.replace(/_/g, ' ').toLowerCase()}` });
      }
      if (to === 'COMPLETED') {
        const open = await tx.trip.count({ where: { allocationId: trip.allocationId, status: { notIn: ['COMPLETED', 'CANCELLED'] } } });
        await tx.bookingAllocation.update({ where: { id: trip.allocationId }, data: { status: open === 0 ? 'COMPLETED' : 'IN_PROGRESS' } });
      }
    }
    return { from: trip.status, to, booking, extra };
  });

  if (result.to === 'DELIVERED' && result.from !== 'DELIVERED') {
    const pdf = await demoDeliveryProofPdf(result.booking.id);
    const key = await storage.put('trip-documents', pdf, 'pdf');
    await prisma.tripDocument.create({
      data: { tripId, bookingId: result.booking.id, type: 'DELIVERY_PROOF', title: 'Proof of delivery (simulated)', fileName: `${result.booking.bookingCode}-POD.pdf`, storageKey: key, mimeType: 'application/pdf', sizeBytes: pdf.length, isDemo: true },
    });
  }
  const notice = result.to !== result.from ? NOTICE[result.to] : undefined;
  if (notice) {
    await notify({ companyId, type: notice.type, title: `${notice.title} (demo)`, message: notice.message(result.booking.bookingCode, result.extra), bookingId: result.booking.id, link: `/company/trips/${tripId}` });
  }
  return { from: result.from, to: result.to };
}

export const demoInfo = () => ({ enabled: env.DEMO_MODE && !env.isProduction });
