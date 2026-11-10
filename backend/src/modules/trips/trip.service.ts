import type { Prisma, TripStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/errors';
import { decodePolyline, haversineKm, type LatLng } from '../../utils/polyline';

export const ACTIVE_TRIP: TripStatus[] = ['SCHEDULED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'DRIVER_ACCEPTED', 'REACHED_PICKUP', 'LOADING', 'LOADING_COMPLETED', 'IN_TRANSIT', 'REACHED_DESTINATION', 'UNLOADING_STARTED', 'UNLOADING_COMPLETED'];

const tripInclude = {
  booking: {
    select: {
      id: true, bookingCode: true, status: true, distanceKm: true, durationMinutes: true, routePolyline: true, loadingDate: true, loadingTime: true,
      expectedDeliveryDate: true, isDemo: true,
      product: { select: { name: true } },
      locations: { select: { type: true, address: true, city: true, latitude: true, longitude: true } },
      requirement: { select: { tankerCapacityKl: true } },
    },
  },
  transporter: { select: { id: true, companyName: true, rating: true, isDemo: true, owner: { select: { phone: true } } } },
  tanker: { select: { registrationNumber: true, capacityKl: true, compartments: true, tankerType: { select: { name: true } } } },
  driver: { select: { id: true, isDemo: true, user: { select: { fullName: true, phone: true } } } },
} satisfies Prisma.TripInclude;

function shape(trip: Prisma.TripGetPayload<{ include: typeof tripInclude }>) {
  const { transporter, ...rest } = trip;
  return {
    ...rest,
    transporter: { id: transporter.id, companyName: transporter.companyName, rating: transporter.rating, isDemo: transporter.isDemo, contactPhone: transporter.owner.phone },
    pickup: trip.booking.locations.find((l) => l.type === 'PICKUP') ?? null,
    delivery: trip.booking.locations.find((l) => l.type === 'DELIVERY') ?? null,
    trackingSource: trip.isSimulated ? 'SIMULATED' : 'GPS',
  };
}

export async function listTrips(companyId: string, filter: { scope?: 'active' | 'completed' | 'all' }) {
  const status =
    filter.scope === 'active' ? { in: ACTIVE_TRIP } : filter.scope === 'completed' ? { in: ['DELIVERED', 'COMPLETED'] as TripStatus[] } : undefined;
  const trips = await prisma.trip.findMany({
    where: { booking: { companyId }, ...(status ? { status } : {}) },
    include: tripInclude,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return trips.map(shape);
}

export async function getTrip(companyId: string, tripId: string) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, booking: { companyId } }, include: tripInclude });
  if (!trip) throw AppError.notFound('Trip not found');
  return shape(trip);
}

/** Remaining road distance: distance along the planned route from the point nearest the tanker. */
export function remainingAlongRoute(path: LatLng[], position: LatLng): number {
  if (path.length < 2) return 0;
  let nearest = 0;
  let best = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = haversineKm(path[i], position);
    if (d < best) {
      best = d;
      nearest = i;
    }
  }
  let km = 0;
  for (let i = nearest + 1; i < path.length; i++) km += haversineKm(path[i - 1], path[i]);
  return Math.round(km * 10) / 10;
}

export async function getTracking(companyId: string, tripId: string) {
  return buildTracking(await getTrip(companyId, tripId));
}

/** Tracking view for the owning transporter or the assigned driver. */
export async function getTrackingScoped(where: Prisma.TripWhereInput, tripId: string) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, ...where }, include: tripInclude });
  if (!trip) throw AppError.notFound('Trip not found');
  return buildTracking(shape(trip));
}

async function buildTracking(trip: ReturnType<typeof shape>) {
  const tripId = trip.id;
  const points = await prisma.tripTracking.findMany({
    where: { tripId },
    orderBy: { recordedAt: 'asc' },
    take: 2000,
    select: { latitude: true, longitude: true, speedKmph: true, heading: true, source: true, recordedAt: true },
  });
  const path = trip.booking.routePolyline ? decodePolyline(trip.booking.routePolyline) : [];
  const last = points[points.length - 1];
  const position = last ? { lat: last.latitude.toNumber(), lng: last.longitude.toNumber() } : null;
  const planned = trip.plannedDistanceKm.toNumber();
  const remainingKm = position && path.length ? remainingAlongRoute(path, position) : trip.status === 'DELIVERED' || trip.status === 'COMPLETED' ? 0 : planned;
  const travelled = Math.max(0, Math.round((planned - remainingKm) * 10) / 10);
  const simulated = points.some((p) => p.source === 'SIMULATED') || trip.isSimulated;
  return {
    tripId: trip.id,
    tripCode: trip.tripCode,
    status: trip.status,
    bookingId: trip.booking.id,
    bookingCode: trip.booking.bookingCode,
    plannedPolyline: trip.booking.routePolyline,
    pickup: trip.pickup,
    delivery: trip.delivery,
    currentPosition: position ? { ...position, heading: last!.heading, speedKmph: last!.speedKmph, recordedAt: last!.recordedAt } : null,
    breadcrumb: points.map((p) => ({ lat: p.latitude.toNumber(), lng: p.longitude.toNumber(), at: p.recordedAt })),
    plannedDistanceKm: planned,
    distanceTravelledKm: travelled,
    remainingDistanceKm: remainingKm,
    etaAt: trip.etaAt,
    lastGpsAt: trip.lastGpsAt,
    dataSource: simulated ? 'SIMULATED' : points.length ? 'GPS' : 'NONE',
    dataSourceLabel: simulated
      ? 'Simulated demo data — not live GPS. Real tracking activates with the Driver app / GPS integration.'
      : points.length
        ? 'Live GPS'
        : 'Waiting for the first GPS update',
  };
}
