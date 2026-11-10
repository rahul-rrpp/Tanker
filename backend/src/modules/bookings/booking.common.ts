import type { ActorType, BookingStatus, Prisma } from '@prisma/client';
import type { Tx } from '../../lib/prisma';
import { AppError } from '../../utils/errors';

/** Booking status groups used by the "My Bookings" tabs. */
export const BOOKING_TABS = {
  all: null,
  searching: ['SEARCHING'],
  offers: ['OFFERS_RECEIVED'],
  negotiation: ['NEGOTIATION'],
  confirmed: ['CONFIRMED'],
  vehicle_assigned: ['VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED'],
  loading: ['LOADING'],
  in_transit: ['IN_TRANSIT'],
  completed: ['DELIVERED', 'COMPLETED'],
  cancelled: ['CANCELLED'],
  disputed: ['DISPUTED'],
} as const satisfies Record<string, readonly BookingStatus[] | null>;

export type BookingTab = keyof typeof BOOKING_TABS;

export const OPEN_FOR_OFFERS: BookingStatus[] = ['SEARCHING', 'OFFERS_RECEIVED', 'NEGOTIATION'];
export const PENDING_STATUSES: BookingStatus[] = ['SEARCHING', 'OFFERS_RECEIVED', 'NEGOTIATION'];
export const ACTIVE_TRIP_STATUSES: BookingStatus[] = ['CONFIRMED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'LOADING', 'IN_TRANSIT'];
export const COMPLETED_STATUSES: BookingStatus[] = ['DELIVERED', 'COMPLETED'];
export const CANCELLABLE: BookingStatus[] = ['SEARCHING', 'OFFERS_RECEIVED', 'NEGOTIATION', 'CONFIRMED'];
export const CONFIRMED_OR_LATER: BookingStatus[] = ['CONFIRMED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'LOADING', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'DISPUTED'];

/** Locks the booking row for the rest of the transaction (serialises accept/counter/cancel). */
export async function lockBooking(tx: Tx, bookingId: string, companyId?: string) {
  const rows = await tx.$queryRaw<{ id: string; companyId: string }[]>`
    SELECT id, "companyId" FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
  const row = rows[0];
  // 404 (not 403) for other tenants' bookings, so existence is never revealed.
  if (!row || (companyId && row.companyId !== companyId)) throw AppError.notFound('Booking not found');
  return tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { requirement: true } });
}

export async function setBookingStatus(
  tx: Tx,
  booking: { id: string; status: BookingStatus },
  to: BookingStatus,
  actor: { type: ActorType; userId?: string | null; note?: string },
  extra: Prisma.BookingUpdateInput = {},
) {
  if (booking.status === to && Object.keys(extra).length === 0) return;
  await tx.booking.update({ where: { id: booking.id }, data: { status: to, version: { increment: 1 }, ...extra } });
  if (booking.status !== to) {
    await tx.bookingStatusHistory.create({
      data: { bookingId: booking.id, fromStatus: booking.status, toStatus: to, actorType: actor.type, actorUserId: actor.userId ?? null, note: actor.note },
    });
  }
}

/** Date-only string (YYYY-MM-DD) for "today" in India. */
export function todayIst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}
