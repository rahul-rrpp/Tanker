import type { ActorType, BookingStatus, NotificationType, Prisma, TankerStatus, TripStatus } from '@prisma/client';
import type { Request } from 'express';
import { prisma, type Tx } from '../../lib/prisma';
import { emitToTransporter, emitToTrip } from '../../lib/realtime';
import { AppError, ErrorCode } from '../../utils/errors';
import { audit } from '../audit/audit';
import { lockBooking, setBookingStatus } from '../bookings/booking.common';
import { notify, notifyTransporter } from '../notifications/notification.service';

/**
 * Controlled trip status engine: the only code path that advances a real trip. Every change is validated
 * against FLOW, recorded in trip_status_history (who, from, to, when, where, remarks), and propagated to
 * the tanker, allocation, booking and settlement in the same transaction.
 */

export const FLOW: TripStatus[] = [
  'SCHEDULED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'DRIVER_ACCEPTED', 'REACHED_PICKUP', 'LOADING', 'LOADING_COMPLETED',
  'IN_TRANSIT', 'REACHED_DESTINATION', 'UNLOADING_STARTED', 'UNLOADING_COMPLETED', 'DELIVERED', 'COMPLETED',
];

/** Driver buttons, each allowed from exactly one status. */
export const DRIVER_ACTIONS = {
  CONFIRM_ASSIGNMENT: { from: 'DRIVER_ASSIGNED', to: 'DRIVER_ACCEPTED' },
  REACHED_PICKUP: { from: 'DRIVER_ACCEPTED', to: 'REACHED_PICKUP' },
  START_LOADING: { from: 'REACHED_PICKUP', to: 'LOADING' },
  COMPLETE_LOADING: { from: 'LOADING', to: 'LOADING_COMPLETED' },
  START_TRIP: { from: 'LOADING_COMPLETED', to: 'IN_TRANSIT' },
  REACHED_DELIVERY: { from: 'IN_TRANSIT', to: 'REACHED_DESTINATION' },
  START_UNLOADING: { from: 'REACHED_DESTINATION', to: 'UNLOADING_STARTED' },
  COMPLETE_UNLOADING: { from: 'UNLOADING_STARTED', to: 'UNLOADING_COMPLETED' },
  SUBMIT_COMPLETION: { from: 'UNLOADING_COMPLETED', to: 'DELIVERED' },
} as const satisfies Record<string, { from: TripStatus; to: TripStatus }>;
export type DriverAction = keyof typeof DRIVER_ACTIONS;

export const TRACKABLE: TripStatus[] = ['DRIVER_ACCEPTED', 'REACHED_PICKUP', 'LOADING', 'LOADING_COMPLETED', 'IN_TRANSIT', 'REACHED_DESTINATION', 'UNLOADING_STARTED', 'UNLOADING_COMPLETED'];

const TANKER_STATUS: Partial<Record<TripStatus, TankerStatus>> = {
  VEHICLE_ASSIGNED: 'BOOKED', LOADING: 'LOADING', IN_TRANSIT: 'IN_TRANSIT', UNLOADING_STARTED: 'UNLOADING',
};

/** A multi-tanker booking moves only as far as its least-advanced trip. */
const BOOKING_FOR_TRIP: Partial<Record<TripStatus, BookingStatus>> = {
  SCHEDULED: 'CONFIRMED', VEHICLE_ASSIGNED: 'VEHICLE_ASSIGNED', DRIVER_ASSIGNED: 'DRIVER_ASSIGNED', DRIVER_ACCEPTED: 'DRIVER_ASSIGNED', REACHED_PICKUP: 'DRIVER_ASSIGNED',
  LOADING: 'LOADING', LOADING_COMPLETED: 'LOADING', IN_TRANSIT: 'IN_TRANSIT', REACHED_DESTINATION: 'IN_TRANSIT', UNLOADING_STARTED: 'IN_TRANSIT', UNLOADING_COMPLETED: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED', COMPLETED: 'COMPLETED',
};
const BOOKING_ORDER: BookingStatus[] = ['CONFIRMED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'LOADING', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];

const COMPANY_NOTICE: Partial<Record<TripStatus, { type: NotificationType; title: string; message: (code: string) => string }>> = {
  LOADING: { type: 'LOADING_STARTED', title: 'Loading started', message: (c) => `Loading has started for ${c}.` },
  LOADING_COMPLETED: { type: 'LOADING_COMPLETED', title: 'Loading completed', message: (c) => `Loading is complete for ${c}.` },
  IN_TRANSIT: { type: 'TRIP_STARTED', title: 'Trip started', message: (c) => `${c} is loaded and on the way.` },
  DELIVERED: { type: 'DELIVERY_COMPLETED', title: 'Delivery completed', message: (c) => `${c} has been delivered. Proof of delivery is in Documents.` },
};

export interface Actor {
  type: ActorType;
  userId: string;
}

export interface TransitionMeta {
  remarks?: string;
  latitude?: number;
  longitude?: number;
  req?: Request;
  /** Extra trip columns to write with this change. */
  data?: Prisma.TripUncheckedUpdateInput;
}

/** Applies one validated status change. Callers hold the booking row lock. */
export async function transition(tx: Tx, trip: { id: string; status: TripStatus; bookingId: string; allocationId: string; tankerId: string | null }, to: TripStatus, actor: Actor, meta: TransitionMeta = {}) {
  const from = FLOW.indexOf(trip.status);
  if (from < 0 || FLOW.indexOf(to) !== from + 1) {
    throw AppError.conflict(`A trip cannot move from ${trip.status.replace(/_/g, ' ').toLowerCase()} to ${to.replace(/_/g, ' ').toLowerCase()}`, ErrorCode.INVALID_STATE_TRANSITION);
  }
  const moved = await tx.trip.updateMany({ where: { id: trip.id, status: trip.status }, data: { ...meta.data, status: to } });
  if (moved.count !== 1) throw AppError.conflict('This trip changed in the meantime. Reload and try again.', ErrorCode.INVALID_STATE_TRANSITION);
  await recordHistory(tx, trip.id, trip.status, to, actor, meta);
  const tankerStatus = TANKER_STATUS[to];
  if (tankerStatus && trip.tankerId) await tx.tanker.update({ where: { id: trip.tankerId }, data: { status: tankerStatus } });
  if (to === 'VEHICLE_ASSIGNED') await tx.bookingAllocation.updateMany({ where: { id: trip.allocationId, status: 'CONFIRMED' }, data: { status: 'IN_PROGRESS' } });
  await syncBooking(tx, trip.bookingId, actor);
  await audit({ action: 'trip.status_changed', entityType: 'trip', entityId: trip.id, actorType: actor.type, actorUserId: actor.userId, metadata: { from: trip.status, to }, req: meta.req }, tx);
}

export function recordHistory(tx: Tx, tripId: string, from: TripStatus | null, to: TripStatus, actor: Actor, meta: TransitionMeta) {
  return tx.tripStatusHistory.create({ data: { tripId, fromStatus: from, toStatus: to, actorType: actor.type, actorUserId: actor.userId, reason: meta.remarks, latitude: meta.latitude, longitude: meta.longitude } });
}

async function syncBooking(tx: Tx, bookingId: string, actor: Actor) {
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { id: true, status: true } });
  if (!BOOKING_ORDER.includes(booking.status)) return; // partially allocated, cancelled or disputed
  const trips = await tx.trip.findMany({ where: { bookingId, status: { not: 'CANCELLED' } }, select: { status: true } });
  if (trips.length === 0) return;
  const least = trips.reduce((m, t) => (FLOW.indexOf(t.status) < FLOW.indexOf(m) ? t.status : m), 'COMPLETED' as TripStatus);
  const target = BOOKING_FOR_TRIP[least];
  if (target && BOOKING_ORDER.indexOf(target) > BOOKING_ORDER.indexOf(booking.status)) {
    await setBookingStatus(tx, booking, target, { type: actor.type, userId: actor.userId, note: `Trip progress: ${least.replace(/_/g, ' ').toLowerCase()}` });
  }
}

/** Post-commit side effects. Kept out of the transaction so a slow channel cannot hold the booking lock. */
export async function announce(trip: { id: string; bookingId: string; transporterId: string }, to: TripStatus) {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: trip.bookingId }, select: { bookingCode: true, companyId: true } });
  const n = COMPANY_NOTICE[to];
  if (n) await notify({ companyId: booking.companyId, type: n.type, title: `${n.title}: ${booking.bookingCode}`, message: n.message(booking.bookingCode), bookingId: trip.bookingId, link: `/company/trips/${trip.id}` });
  if (to === 'IN_TRANSIT' || to === 'DELIVERED') {
    const label = to === 'IN_TRANSIT' ? 'started' : 'delivered';
    await notifyTransporter(trip.transporterId, { type: to === 'IN_TRANSIT' ? 'TRIP_STARTED' : 'DELIVERY_COMPLETED', title: `Trip ${label}: ${booking.bookingCode}`, message: `Your driver updated ${booking.bookingCode} to ${label}.`, bookingId: trip.bookingId, link: `/transporter/trips/${trip.id}` });
  }
  emitToTrip(trip.id, 'trip:status', { tripId: trip.id, status: to });
  emitToTransporter(trip.transporterId, 'trip:status', { tripId: trip.id, status: to });
}

/**
 * Transporter closes a delivered trip and releases the tanker at its ACTUAL location: the given location,
 * otherwise the delivery point. It is never assumed to be back at its original pickup.
 */
export async function completeTrip(transporterId: string, tripId: string, actor: Actor, input: { availableLocation?: string; availableLatitude?: number; availableLongitude?: number; availableFrom?: Date; remarks?: string }, req?: Request) {
  const ref = await prisma.trip.findFirst({ where: { id: tripId, transporterId }, select: { bookingId: true } });
  if (!ref) throw AppError.notFound('Trip not found');
  const result = await prisma.$transaction(async (tx) => {
    await lockBooking(tx, ref.bookingId);
    const trip = await tx.trip.findUniqueOrThrow({ where: { id: tripId }, include: { booking: { include: { locations: true } } } });
    const now = new Date();
    await transition(tx, trip, 'COMPLETED', actor, { remarks: input.remarks, req, data: { completedAt: now, releasedAt: now } });
    if (trip.tankerId) {
      const drop = trip.booking.locations.find((l) => l.type === 'DELIVERY');
      await tx.tanker.update({
        where: { id: trip.tankerId },
        data: {
          status: 'AVAILABLE',
          availableFrom: input.availableFrom ?? now,
          availableLocation: input.availableLocation ?? drop?.address.slice(0, 200) ?? null,
          availableLatitude: input.availableLatitude ?? trip.lastLatitude ?? drop?.latitude ?? null,
          availableLongitude: input.availableLongitude ?? trip.lastLongitude ?? drop?.longitude ?? null,
        },
      });
    }
    await tx.agency.update({ where: { id: transporterId }, data: { completedTrips: { increment: 1 } } });
    const open = await tx.trip.count({ where: { allocationId: trip.allocationId, status: { notIn: ['COMPLETED', 'CANCELLED'] } } });
    if (open === 0) {
      await tx.bookingAllocation.update({ where: { id: trip.allocationId }, data: { status: 'COMPLETED' } });
      // Delivered in full: the payout is now due. Amount and any payout remain admin-controlled.
      await tx.settlement.updateMany({ where: { allocationId: trip.allocationId, status: 'ON_HOLD' }, data: { status: 'PENDING' } });
    }
    return trip;
  });
  await notify({ companyId: result.booking.companyId, type: 'DELIVERY_COMPLETED', title: `Trip closed: ${result.booking.bookingCode}`, message: 'The transporter has closed this trip.', bookingId: result.bookingId, link: `/company/trips/${tripId}` });
  await notifyTransporter(transporterId, { type: 'TRIP_COMPLETED', title: `Trip completed: ${result.tripCode}`, message: 'The tanker has been released and the settlement is now pending.', bookingId: result.bookingId, link: `/transporter/trips/${tripId}` });
  emitToTrip(tripId, 'trip:status', { tripId, status: 'COMPLETED' });
  return { tripId, status: 'COMPLETED' as const };
}

/** Maps the database exclusion constraints to a clean 409. */
export function asResourceConflict(e: unknown): never {
  const msg = String((e as Error)?.message ?? '');
  if (msg.includes('trips_tanker_no_overlap')) throw AppError.conflict('This tanker already has an overlapping assignment', ErrorCode.RESOURCE_CONFLICT);
  if (msg.includes('trips_driver_no_overlap')) throw AppError.conflict('This driver already has an overlapping assignment', ErrorCode.RESOURCE_CONFLICT);
  throw e;
}
