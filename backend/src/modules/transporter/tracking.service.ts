import type { TrackingSource } from '@prisma/client';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { emitToTransporter, emitToTrip } from '../../lib/realtime';
import { AppError, ErrorCode } from '../../utils/errors';
import { decodePolyline, haversineKm, type LatLng } from '../../utils/polyline';
import { notifyTransporter } from '../notifications/notification.service';
import { getSettings } from '../settings/settings.service';
import { remainingAlongRoute } from '../trips/trip.service';
import { TRACKABLE } from './trip.engine';

export interface LocationPoint {
  latitude: number;
  longitude: number;
  speedKmph?: number;
  heading?: number;
  recordedAt: Date;
}

const CLOCK_SKEW_MS = 5 * 60_000;

function distanceToRouteKm(path: LatLng[], p: LatLng): number {
  return path.reduce((best, q) => Math.min(best, haversineKm(q, p)), Infinity);
}

/** Opens an alert once; while one of the same type is unresolved, repeats are ignored. */
async function raiseAlert(trip: { id: string; transporterId: string; tripCode: string; bookingId: string }, type: string, severity: string, message: string, isSimulated = false) {
  const open = await prisma.tripAlert.findFirst({ where: { tripId: trip.id, type, resolvedAt: null }, select: { id: true } });
  if (open) return;
  await prisma.tripAlert.create({ data: { tripId: trip.id, type, severity, message, isSimulated } });
  await notifyTransporter(trip.transporterId, { type: 'ADMIN_ALERT', title: `${type.replace(/_/g, ' ')}: ${trip.tripCode}`, message, bookingId: trip.bookingId, link: `/transporter/trips/${trip.id}` });
  emitToTransporter(trip.transporterId, 'trip:alert', { tripId: trip.id, type });
}

const resolve = (tripId: string, type: string, note: string) => prisma.tripAlert.updateMany({ where: { tripId, type, resolvedAt: null }, data: { resolvedAt: new Date(), resolutionNote: note } });

/** Stores GPS points for one trip, updates the live position and ETA, and broadcasts. Accepts offline batches. */
export async function recordLocations(tripId: string, points: LocationPoint[], source: TrackingSource) {
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId }, include: { booking: { select: { routePolyline: true, durationMinutes: true } } } });
  if (!TRACKABLE.includes(trip.status)) throw AppError.conflict('Location sharing is only available during an active trip', ErrorCode.INVALID_STATE_TRANSITION);
  const now = Date.now();
  const valid = points.filter((p) => p.recordedAt.getTime() <= now + CLOCK_SKEW_MS).sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  if (valid.length === 0) throw AppError.badRequest('No usable location points');
  await prisma.tripTracking.createMany({ data: valid.map((p) => ({ tripId, latitude: p.latitude, longitude: p.longitude, speedKmph: p.speedKmph, heading: p.heading, source, recordedAt: p.recordedAt })) });

  const last = valid[valid.length - 1];
  // A late offline batch must not move the live marker backwards.
  if (trip.lastGpsAt && last.recordedAt <= trip.lastGpsAt) return { stored: valid.length, lastGpsAt: trip.lastGpsAt };

  const here = { lat: last.latitude, lng: last.longitude };
  const path = trip.booking.routePolyline ? decodePolyline(trip.booking.routePolyline) : [];
  const planned = trip.plannedDistanceKm.toNumber();
  const remaining = path.length ? remainingAlongRoute(path, here) : planned;
  const ratio = planned > 0 ? Math.min(1, remaining / planned) : 0;
  const etaAt = new Date(now + Math.round(trip.booking.durationMinutes * ratio) * 60_000);
  await prisma.trip.update({ where: { id: tripId }, data: { lastLatitude: last.latitude, lastLongitude: last.longitude, lastGpsAt: last.recordedAt, etaAt, distanceTravelledKm: Math.max(0, Math.round((planned - remaining) * 100) / 100) } });
  if (trip.tankerId) await prisma.tanker.update({ where: { id: trip.tankerId }, data: { currentLatitude: last.latitude, currentLongitude: last.longitude, lastLocationAt: last.recordedAt } });

  await resolve(tripId, 'GPS_OFFLINE', 'Location updates resumed');
  if (trip.status === 'IN_TRANSIT' && path.length) {
    const s = await getSettings();
    if (distanceToRouteKm(path, here) > s.routeDeviationKm) await raiseAlert(trip, 'ROUTE_DEVIATION', 'HIGH', `Tanker is more than ${s.routeDeviationKm} km off the planned route.`, source === 'SIMULATED');
    else await resolve(tripId, 'ROUTE_DEVIATION', 'Back on the planned route');
  }
  const payload = { tripId, lat: last.latitude, lng: last.longitude, heading: last.heading ?? null, speedKmph: last.speedKmph ?? null, recordedAt: last.recordedAt, etaAt, remainingKm: remaining, source };
  emitToTrip(tripId, 'trip:location', payload);
  emitToTransporter(trip.transporterId, 'trip:location', payload);
  return { stored: valid.length, lastGpsAt: last.recordedAt };
}

/** Periodic detection of conditions no incoming update can reveal: silence, long stops and lateness. */
export async function sweepTripAlerts() {
  const s = await getSettings();
  const now = Date.now();
  const trips = await prisma.trip.findMany({
    where: { status: { in: TRACKABLE }, isSimulated: false },
    select: { id: true, transporterId: true, tripCode: true, bookingId: true, status: true, lastGpsAt: true, etaAt: true, plannedEndAt: true, booking: { select: { expectedDeliveryDate: true } } },
    take: 500,
  });
  for (const t of trips) {
    try {
      if (t.lastGpsAt && now - t.lastGpsAt.getTime() > s.gpsOfflineMinutes * 60_000) await raiseAlert(t, 'GPS_OFFLINE', 'MEDIUM', `No location update for over ${s.gpsOfflineMinutes} minutes.`);
      if (t.status === 'IN_TRANSIT') {
        const since = new Date(now - s.stoppageMinutes * 60_000);
        const recent = await prisma.tripTracking.findMany({ where: { tripId: t.id, recordedAt: { gte: since } }, orderBy: { recordedAt: 'asc' }, select: { latitude: true, longitude: true } });
        if (recent.length >= 2) {
          const a = recent[0];
          const b = recent[recent.length - 1];
          const moved = haversineKm({ lat: a.latitude.toNumber(), lng: a.longitude.toNumber() }, { lat: b.latitude.toNumber(), lng: b.longitude.toNumber() });
          if (moved < 0.2) await raiseAlert(t, 'EXTENDED_STOPPAGE', 'MEDIUM', `Tanker has not moved for ${s.stoppageMinutes} minutes.`);
          else await resolve(t.id, 'EXTENDED_STOPPAGE', 'Tanker is moving again');
        }
        const due = new Date(`${t.booking.expectedDeliveryDate.toISOString().slice(0, 10)}T23:59:59+05:30`);
        if (t.etaAt && t.etaAt > due) await raiseAlert(t, 'DELAYED_DELIVERY', 'MEDIUM', 'Estimated arrival is after the expected delivery date.');
      }
    } catch (err) {
      logger.error({ err, tripId: t.id }, 'Trip alert sweep failed for trip');
    }
  }
}
