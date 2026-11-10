import type { Booking, BookingRequirement, Prisma, Product, Tanker, TripStatus } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma';
import { haversineKm } from '../../utils/polyline';
import { getSettings, type PlatformSettings } from '../settings/settings.service';

/**
 * Date-aware matching shared by the marketplace, offer submission and tanker assignment, so the three can
 * never disagree. A tanker is usable only if it is verified, compatible, in date for compliance and free
 * for the whole booking window. Status alone is not enough: a tanker on a trip today may be free next week.
 */

export const BUSY_TRIP: TripStatus[] = ['VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'DRIVER_ACCEPTED', 'REACHED_PICKUP', 'LOADING', 'LOADING_COMPLETED', 'IN_TRANSIT', 'REACHED_DESTINATION', 'UNLOADING_STARTED', 'UNLOADING_COMPLETED', 'DELIVERED', 'DISPUTED'];
const OUT_OF_SERVICE = ['MAINTENANCE', 'UNAVAILABLE', 'SUSPENDED', 'INACTIVE'] as const;

export interface Window {
  start: Date;
  end: Date;
}

/** Booking window in UTC, from the booking's India-time loading slot to expected delivery plus a buffer. */
export function bookingWindow(b: Pick<Booking, 'loadingDate' | 'loadingTime' | 'expectedDeliveryDate'>, s: Pick<PlatformSettings, 'assignmentBufferHours'>): Window {
  const start = new Date(`${b.loadingDate.toISOString().slice(0, 10)}T${b.loadingTime}:00+05:30`);
  const end = new Date(new Date(`${b.expectedDeliveryDate.toISOString().slice(0, 10)}T23:59:59+05:30`).getTime() + s.assignmentBufferHours * 3600_000);
  return { start, end: end > start ? end : new Date(start.getTime() + 3600_000) };
}

type BookingForMatch = Booking & { requirement: BookingRequirement | null; product?: Pick<Product, 'requiresSpecialApproval'> | null };

export const tankerMatchInclude = {
  trips: { where: { status: { in: BUSY_TRIP } }, select: { id: true, plannedStartAt: true, plannedEndAt: true } },
  availabilityBlocks: { where: { cancelledAt: null }, select: { startAt: true, endAt: true } },
  products: { select: { productId: true } },
} satisfies Prisma.TankerInclude;

export type MatchTanker = Prisma.TankerGetPayload<{ include: typeof tankerMatchInclude }>;

const overlaps = (aStart: Date, aEnd: Date, w: Window) => aStart < w.end && aEnd > w.start;
const lapsed = (d: Date | null, w: Window) => Boolean(d && d < w.end);

/** First reason this tanker cannot serve the booking, or null if it can. */
export function tankerProblem(t: MatchTanker, b: BookingForMatch, w: Window, opts: { ignoreTripId?: string; requiresPeso: boolean }): string | null {
  const r = b.requirement!;
  if (t.verificationStatus !== 'APPROVED') return 'Tanker is not verified';
  if ((OUT_OF_SERVICE as readonly string[]).includes(t.status)) return `Tanker is ${t.status.toLowerCase()}`;
  if (t.capacityKl.lessThan(r.tankerCapacityKl)) return 'Tanker capacity is below the requirement';
  if (!t.products.some((p) => p.productId === b.productId)) return 'Tanker is not certified for this product';
  if (r.tankerTypeId && t.tankerTypeId !== r.tankerTypeId) return 'Tanker type does not match';
  if (r.compartmentRequirement === 'MULTI' && t.compartments < 2) return 'Multi-compartment tanker required';
  if (r.compartmentRequirement === 'SINGLE' && t.compartments !== 1) return 'Single-compartment tanker required';
  for (const [label, d] of [['Insurance', t.insuranceExpiry], ['Fitness', t.fitnessExpiry], ['Permit', t.permitExpiry], ['PUC', t.pucExpiry]] as const) {
    if (lapsed(d, w)) return `${label} expires before this trip ends`;
  }
  if (opts.requiresPeso && (!t.pesoLicenceNumber || lapsed(t.pesoExpiry, w))) return 'Valid PESO licence required for this product';
  if (t.availableFrom && t.availableFrom > w.start) return 'Tanker is not available until later';
  if (t.availabilityBlocks.some((x) => overlaps(x.startAt, x.endAt, w))) return 'Tanker is blocked for these dates';
  // Assigned trips from before windows existed have no window: treat them as busy.
  const busy = t.trips.some((x) => x.id !== opts.ignoreTripId && (!x.plannedStartAt || !x.plannedEndAt || overlaps(x.plannedStartAt, x.plannedEndAt, w)));
  if (busy) return 'Tanker has an overlapping assignment';
  return null;
}

export const needsPeso = (product?: Pick<Product, 'requiresSpecialApproval'> | null) => Boolean(product?.requiresSpecialApproval);

export async function fleetForMatching(transporterId: string, tx: Tx = prisma) {
  return tx.tanker.findMany({ where: { transporterId }, include: tankerMatchInclude });
}

export function compatible(fleet: MatchTanker[], b: BookingForMatch, w: Window) {
  const requiresPeso = needsPeso(b.product);
  return fleet.filter((t) => tankerProblem(t, b, w, { requiresPeso }) === null);
}

/** Straight-line distance for the eligibility radius only. Labelled approximate; never used as road distance. */
export function approxKmFromTanker(t: Pick<Tanker, 'availableLatitude' | 'availableLongitude' | 'currentLatitude' | 'currentLongitude'>, pickup: { latitude: Prisma.Decimal; longitude: Prisma.Decimal }): number | null {
  const lat = t.availableLatitude ?? t.currentLatitude;
  const lng = t.availableLongitude ?? t.currentLongitude;
  if (lat === null || lng === null) return null;
  return Math.round(haversineKm({ lat: lat.toNumber(), lng: lng.toNumber() }, { lat: pickup.latitude.toNumber(), lng: pickup.longitude.toNumber() }));
}

export const matchSettings = getSettings;
