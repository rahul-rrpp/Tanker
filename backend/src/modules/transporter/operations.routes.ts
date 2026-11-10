import type { Prisma, TripStatus } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma, type Tx } from '../../lib/prisma';
import { authenticateUser } from '../../middleware/auth';
import { requireTransporter, transporterCallerOnly } from '../../middleware/transporter';
import { sendStoredFile } from '../../middleware/upload';
import { validateRequest } from '../../middleware/validate';
import { AppError, ErrorCode } from '../../utils/errors';
import { ok } from '../../utils/response';
import { audit } from '../audit/audit';
import { lockBooking } from '../bookings/booking.common';
import { notify, notifyDriver } from '../notifications/notification.service';
import { getSettings } from '../settings/settings.service';
import { ACTIVE_TRIP, getTrackingScoped } from '../trips/trip.service';
import { idParam, notVerified, pageOf, parsePaging, tid, uid } from './common';
import { listMyOffers } from './marketplace.routes';
import { BUSY_TRIP, bookingWindow, needsPeso, tankerMatchInclude, tankerProblem } from './matching.service';
import { recordLocations } from './tracking.service';
import { asResourceConflict, completeTrip, recordHistory, transition } from './trip.engine';

const actorOf = (req: Request) => ({ type: 'TRANSPORTER' as const, userId: uid(req) });
const manageTrips = [authenticateUser, transporterCallerOnly, requireTransporter({ permission: 'agency:trips:manage', verified: true })];

/** Trips before loading starts may have their tanker and driver changed; after that the load is committed. */
const REASSIGNABLE: TripStatus[] = ['SCHEDULED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'DRIVER_ACCEPTED', 'REACHED_PICKUP'];

async function lockedTrip(tx: Tx, req: Request, bookingId: string, tripId: string) {
  const booking = await lockBooking(tx, bookingId);
  const trip = await tx.trip.findFirst({ where: { id: tripId, bookingId, transporterId: tid(req) } });
  if (!trip) throw AppError.notFound('Trip not found');
  if (!REASSIGNABLE.includes(trip.status)) throw AppError.conflict('Assignments are locked once loading has started', ErrorCode.INVALID_STATE_TRANSITION);
  const product = await tx.product.findUniqueOrThrow({ where: { id: booking.productId }, select: { requiresSpecialApproval: true, category: true } });
  return { booking, trip, product };
}

export const transporterBookingsRouter = Router();

transporterBookingsRouter.post('/:id/assign-tanker', ...manageTrips, idParam, validateRequest({ body: z.object({ tripId: z.string().uuid(), tankerId: z.string().uuid() }).strict() }), async (req: Request, res: Response) => {
  const bookingId = String(req.params.id);
  const { tripId, tankerId } = req.body as { tripId: string; tankerId: string };
  const s = await getSettings();
  const out = await prisma
    .$transaction(async (tx) => {
      const { booking, trip, product } = await lockedTrip(tx, req, bookingId, tripId);
      // Row lock serialises competing assignments of this tanker; the exclusion constraint is the backstop.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM tankers WHERE id = ${tankerId}::uuid AND "transporterId" = ${tid(req)}::uuid FOR UPDATE`;
      if (!locked.length) throw AppError.notFound('Tanker not found');
      const tanker = await tx.tanker.findUniqueOrThrow({ where: { id: tankerId }, include: tankerMatchInclude });
      const window = bookingWindow(booking, s);
      const problem = tankerProblem(tanker, { ...booking, product }, window, { ignoreTripId: trip.id, requiresPeso: needsPeso(product) });
      if (problem) throw AppError.conflict(problem, tanker.verificationStatus !== 'APPROVED' ? ErrorCode.NOT_COMPLIANT : ErrorCode.RESOURCE_CONFLICT);
      if (trip.tankerId && trip.tankerId !== tankerId) await tx.tanker.update({ where: { id: trip.tankerId }, data: { status: 'AVAILABLE' } });
      await tx.trip.update({ where: { id: trip.id }, data: { tankerId, plannedStartAt: window.start, plannedEndAt: window.end } });
      if (trip.status === 'SCHEDULED') await transition(tx, { ...trip, tankerId }, 'VEHICLE_ASSIGNED', actorOf(req), { remarks: `Tanker ${tanker.registrationNumber} assigned`, req });
      else {
        await tx.tanker.update({ where: { id: tankerId }, data: { status: 'BOOKED' } });
        await recordHistory(tx, trip.id, trip.status, trip.status, actorOf(req), { remarks: `Tanker changed to ${tanker.registrationNumber}` });
        await audit({ action: 'trip.tanker_changed', entityType: 'trip', entityId: trip.id, actorType: 'TRANSPORTER', actorUserId: uid(req), metadata: { from: trip.tankerId, to: tankerId }, req }, tx);
      }
      return { booking, trip, registration: tanker.registrationNumber, driverId: trip.driverId };
    })
    .catch(asResourceConflict);
  await notify({ companyId: out.booking.companyId, type: 'VEHICLE_ASSIGNED', title: `Vehicle assigned: ${out.booking.bookingCode}`, message: `Tanker ${out.registration} has been assigned.`, bookingId, link: `/company/trips/${tripId}` });
  ok(res, 'Tanker assigned', { tripId, registrationNumber: out.registration });
});

const heavy = ['HMV', 'HGMV', 'HTV', 'TRANS'];

transporterBookingsRouter.post('/:id/assign-driver', ...manageTrips, idParam, validateRequest({ body: z.object({ tripId: z.string().uuid(), driverId: z.string().uuid() }).strict() }), async (req: Request, res: Response) => {
  const bookingId = String(req.params.id);
  const { tripId, driverId } = req.body as { tripId: string; driverId: string };
  const s = await getSettings();
  const out = await prisma
    .$transaction(async (tx) => {
      const { booking, trip, product } = await lockedTrip(tx, req, bookingId, tripId);
      if (!trip.tankerId) throw AppError.conflict('Assign a tanker to this trip first', ErrorCode.INVALID_STATE_TRANSITION);
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Driver" WHERE id = ${driverId}::uuid AND "agencyId" = ${tid(req)}::uuid FOR UPDATE`;
      if (!locked.length) throw AppError.notFound('Driver not found');
      const d = await tx.driver.findUniqueOrThrow({ where: { id: driverId }, include: { user: { select: { fullName: true, accountStatus: true } }, trips: { where: { status: { in: BUSY_TRIP }, id: { not: trip.id } }, select: { plannedStartAt: true, plannedEndAt: true } } } });
      const w = bookingWindow(booking, s);
      if (d.verificationStatus !== 'APPROVED') throw notVerified('This driver');
      if (!d.isActive || d.user.accountStatus === 'SUSPENDED' || d.user.accountStatus === 'DEACTIVATED' || d.employmentStatus !== 'ACTIVE') throw AppError.conflict('This driver is not active', ErrorCode.NOT_COMPLIANT);
      if (!heavy.includes(d.licenceType)) throw AppError.conflict('A heavy-vehicle licence is required', ErrorCode.NOT_COMPLIANT);
      if (d.licenceExpiry < w.end) throw AppError.conflict('Driving licence expires before this trip ends', ErrorCode.NOT_COMPLIANT);
      if (needsPeso(product) || product.category === 'FUEL') {
        const trained = d.hazardousTraining === 'NOT_REQUIRED' || (d.hazardousTraining === 'VALID' && (!d.hazardousTrainingExpiry || d.hazardousTrainingExpiry >= w.end));
        if (!trained) throw AppError.conflict('Valid hazardous goods training is required for this product', ErrorCode.NOT_COMPLIANT);
      }
      if (d.trips.some((t) => !t.plannedStartAt || !t.plannedEndAt || (t.plannedStartAt < w.end && t.plannedEndAt > w.start))) throw AppError.conflict('This driver has a conflicting assignment', ErrorCode.RESOURCE_CONFLICT);
      if (trip.status === 'VEHICLE_ASSIGNED') {
        await tx.trip.update({ where: { id: trip.id }, data: { driverId } });
        await transition(tx, trip, 'DRIVER_ASSIGNED', actorOf(req), { remarks: `Driver ${d.user.fullName} assigned`, req });
      } else {
        // Replacing a driver restarts the driver's confirmation.
        await tx.trip.update({ where: { id: trip.id }, data: { driverId, status: 'DRIVER_ASSIGNED', driverAcceptedAt: null } });
        await recordHistory(tx, trip.id, trip.status, 'DRIVER_ASSIGNED', actorOf(req), { remarks: `Driver changed to ${d.user.fullName}` });
        await audit({ action: 'trip.driver_changed', entityType: 'trip', entityId: trip.id, actorType: 'TRANSPORTER', actorUserId: uid(req), metadata: { from: trip.driverId, to: driverId }, req }, tx);
      }
      return { booking, name: d.user.fullName, previous: trip.driverId, tripCode: trip.tripCode };
    })
    .catch(asResourceConflict);
  await notify({ companyId: out.booking.companyId, type: 'DRIVER_ASSIGNED', title: `Driver assigned: ${out.booking.bookingCode}`, message: `${out.name} will drive this trip.`, bookingId, link: `/company/trips/${tripId}` });
  await notifyDriver(driverId, { type: 'TRIP_ASSIGNED', title: `New trip ${out.tripCode}`, message: 'You have a new trip. Open it to confirm.', bookingId, link: `/driver/trips/${tripId}` });
  if (out.previous && out.previous !== driverId) await notifyDriver(out.previous, { type: 'TRIP_ASSIGNED', title: `Removed from trip ${out.tripCode}`, message: 'You are no longer assigned to this trip.', bookingId, link: '/driver/trips' });
  ok(res, 'Driver assigned', { tripId, driver: out.name });
});

const tripListInclude = {
  tanker: { select: { id: true, registrationNumber: true, capacityKl: true } },
  driver: { select: { id: true, user: { select: { fullName: true, phone: true } } } },
  booking: { select: { id: true, bookingCode: true, status: true, loadingDate: true, loadingTime: true, expectedDeliveryDate: true, isDemo: true, distanceKm: true, company: { select: { name: true } }, product: { select: { name: true } }, requirement: { select: { tankerCapacityKl: true } }, locations: { select: { type: true, city: true, address: true } } } },
} satisfies Prisma.TripInclude;
type TripRow = Prisma.TripGetPayload<{ include: typeof tripListInclude }>;

const shapeTrip = (t: TripRow) => ({
  id: t.id, tripCode: t.tripCode, status: t.status, exception: t.exception, etaAt: t.etaAt, lastGpsAt: t.lastGpsAt, isSimulated: t.isSimulated, createdAt: t.createdAt, startedAt: t.startedAt, deliveredAt: t.deliveredAt, completedAt: t.completedAt, plannedStartAt: t.plannedStartAt, plannedEndAt: t.plannedEndAt,
  tanker: t.tanker ? { id: t.tanker.id, registrationNumber: t.tanker.registrationNumber } : null,
  driver: t.driver ? { id: t.driver.id, name: t.driver.user.fullName, phone: t.driver.user.phone } : null,
  bookingId: t.booking.id, bookingCode: t.booking.bookingCode, company: t.booking.company.name, product: t.booking.product.name, tankerCapacityKl: t.booking.requirement?.tankerCapacityKl.toNumber(), loadingDate: t.booking.loadingDate, loadingTime: t.booking.loadingTime, expectedDeliveryDate: t.booking.expectedDeliveryDate, isDemo: t.booking.isDemo,
  pickup: t.booking.locations.find((l) => l.type === 'PICKUP')?.city ?? null, delivery: t.booking.locations.find((l) => l.type === 'DELIVERY')?.city ?? null,
});

export const transporterTripListRouter = Router();
const opsView = [authenticateUser, requireTransporter({ permission: 'agency:operations:access' })];
const read = [authenticateUser, requireTransporter({ permission: 'agency:read' })];

transporterTripListRouter.get('/me/offers', ...read, listMyOffers);

transporterTripListRouter.get('/me/bookings', ...opsView, async (req: Request, res: Response) => {
  const q = parsePaging(req);
  const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const where: Prisma.BookingAllocationWhereInput = { transporterId: tid(req), status: { in: ['CONFIRMED', 'IN_PROGRESS', ...(req.query.all === '1' ? (['COMPLETED'] as const) : [])] }, ...(search ? { booking: { bookingCode: { contains: search, mode: 'insensitive' as const } } } : {}) };
  const [total, rows] = await Promise.all([
    prisma.bookingAllocation.count({ where }),
    prisma.bookingAllocation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...pageOf(q),
      include: {
        trips: { orderBy: { tripCode: 'asc' }, select: { id: true, tripCode: true, status: true, tanker: { select: { id: true, registrationNumber: true } }, driver: { select: { id: true, user: { select: { fullName: true } } } } } },
        booking: { select: { id: true, bookingCode: true, status: true, isDemo: true, loadingDate: true, loadingTime: true, expectedDeliveryDate: true, loadingContactName: true, loadingContactPhone: true, routePolyline: true, distanceKm: true, company: { select: { name: true, contactPersonName: true, contactPhone: true } }, product: { select: { name: true } }, requirement: { select: { tankerCapacityKl: true } }, locations: { select: { type: true, city: true, address: true, latitude: true, longitude: true } } } },
      },
    }),
  ]);
  ok(res, 'Confirmed bookings', {
    total, page: q.page, pageSize: q.pageSize,
    items: rows.map((a) => ({
      allocationId: a.id, agreedFreight: a.agreedFreight.toNumber(), tankersAllocated: a.tankersAllocated, trips: a.trips,
      allocationStatus: a.status, vehicleAssigned: a.trips.filter((t) => t.tanker).length, driverAssigned: a.trips.filter((t) => t.driver).length,
      ...a.booking, tankerCapacityKl: a.booking.requirement?.tankerCapacityKl.toNumber(), distanceKm: a.booking.distanceKm.toNumber(), requirement: undefined,
      pickup: a.booking.locations.find((l) => l.type === 'PICKUP'), delivery: a.booking.locations.find((l) => l.type === 'DELIVERY'), locations: undefined,
    })),
  });
});

const SCOPES: Record<string, Prisma.TripWhereInput> = { active: { status: { in: ACTIVE_TRIP } }, history: { status: { in: ['DELIVERED', 'COMPLETED', 'CANCELLED', 'DISPUTED'] } } };

transporterTripListRouter.get('/me/trips', ...opsView, async (req: Request, res: Response) => {
  const q = parsePaging(req);
  const s = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const where: Prisma.TripWhereInput = { transporterId: tid(req), ...(SCOPES[String(req.query.scope)] ?? {}), ...(s ? { OR: [{ tripCode: { contains: s, mode: 'insensitive' } }, { booking: { bookingCode: { contains: s, mode: 'insensitive' } } }, { tanker: { registrationNumber: { contains: s.toUpperCase() } } }] } : {}) };
  const [total, rows] = await Promise.all([prisma.trip.count({ where }), prisma.trip.findMany({ where, include: tripListInclude, orderBy: { createdAt: 'desc' }, ...pageOf(q) })]);
  ok(res, 'Trips', { total, page: q.page, pageSize: q.pageSize, items: rows.map(shapeTrip) });
});

transporterTripListRouter.get('/me/active-vehicles', ...opsView, async (req: Request, res: Response) => {
  const trips = await prisma.trip.findMany({ where: { transporterId: tid(req), status: { in: ACTIVE_TRIP }, tankerId: { not: null } }, include: tripListInclude, orderBy: { lastGpsAt: { sort: 'desc', nulls: 'last' } }, take: 200 });
  const full = await prisma.trip.findMany({ where: { id: { in: trips.map((t) => t.id) } }, select: { id: true, lastLatitude: true, lastLongitude: true, distanceTravelledKm: true, plannedDistanceKm: true } });
  const pos = new Map(full.map((f) => [f.id, f]));
  const alerts = await prisma.tripAlert.findMany({ where: { tripId: { in: trips.map((t) => t.id) }, resolvedAt: null }, orderBy: { detectedAt: 'desc' }, select: { id: true, tripId: true, type: true, severity: true, message: true, detectedAt: true, isSimulated: true } });
  ok(res, 'Active vehicles', {
    vehicles: trips.map((t) => {
      const p = pos.get(t.id)!;
      return { ...shapeTrip(t), position: p.lastLatitude && p.lastLongitude ? { lat: p.lastLatitude.toNumber(), lng: p.lastLongitude.toNumber() } : null, travelledKm: p.distanceTravelledKm.toNumber(), plannedKm: p.plannedDistanceKm.toNumber(), alerts: alerts.filter((a) => a.tripId === t.id) };
    }),
  });
});

export const transporterTripsRouter = Router();
const tripView = [authenticateUser, transporterCallerOnly, requireTransporter({ permission: 'agency:operations:access' })];

transporterTripsRouter.get('/:id', ...tripView, idParam, async (req: Request, res: Response) => {
  const t = await prisma.trip.findFirst({ where: { id: String(req.params.id), transporterId: tid(req) }, include: tripListInclude });
  if (!t) throw AppError.notFound('Trip not found');
  const [documents, alerts] = await Promise.all([
    prisma.tripDocument.findMany({ where: { tripId: t.id }, orderBy: { createdAt: 'desc' }, select: { id: true, type: true, title: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true, isDemo: true } }),
    prisma.tripAlert.findMany({ where: { tripId: t.id }, orderBy: { detectedAt: 'desc' }, take: 50 }),
  ]);
  ok(res, 'Trip', { trip: shapeTrip(t), documents, alerts });
});

transporterTripsRouter.get('/:id/history', ...tripView, idParam, async (req: Request, res: Response) => {
  const t = await prisma.trip.findFirst({ where: { id: String(req.params.id), transporterId: tid(req) }, select: { id: true } });
  if (!t) throw AppError.notFound('Trip not found');
  const rows = await prisma.tripStatusHistory.findMany({ where: { tripId: t.id }, orderBy: { createdAt: 'asc' } });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.actorUserId).filter((x): x is string => Boolean(x)) } }, select: { id: true, fullName: true } });
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  ok(res, 'Trip history', { history: rows.map((r) => ({ id: r.id, previousStatus: r.fromStatus, newStatus: r.toStatus, at: r.createdAt, updatedBy: (r.actorUserId && names.get(r.actorUserId)) ?? r.actorType, actorType: r.actorType, remarks: r.reason, location: r.latitude && r.longitude ? { lat: r.latitude.toNumber(), lng: r.longitude.toNumber() } : null, isCorrection: r.isCorrection })) });
});

transporterTripsRouter.get('/:id/tracking', ...tripView, idParam, async (req: Request, res: Response) => {
  ok(res, 'Tracking', { tracking: await getTrackingScoped({ transporterId: tid(req) }, String(req.params.id)) });
});

transporterTripsRouter.get('/:id/documents/:docId/download', ...tripView, validateRequest({ params: z.object({ id: z.string().uuid(), docId: z.string().uuid() }) }), async (req: Request, res: Response) => {
  const d = await prisma.tripDocument.findFirst({ where: { id: String(req.params.docId), tripId: String(req.params.id), trip: { transporterId: tid(req) } } });
  if (!d) throw AppError.notFound('Document not found');
  sendStoredFile(res, d, req.query.inline === '1');
});

transporterTripsRouter.post('/:id/complete', ...manageTrips, idParam, validateRequest({
  body: z.object({ availableLocation: z.string().trim().max(200).optional(), availableLatitude: z.number().min(-90).max(90).optional(), availableLongitude: z.number().min(-180).max(180).optional(), availableFrom: z.coerce.date().optional(), remarks: z.string().trim().max(500).optional() }).strict(),
}), async (req: Request, res: Response) => {
  ok(res, 'Trip completed and tanker released', await completeTrip(tid(req), String(req.params.id), actorOf(req), req.body, req));
});

transporterTripsRouter.post('/:id/issue', ...manageTrips, idParam, validateRequest({ body: z.object({ type: z.enum(['DELAYED', 'EMERGENCY', 'CLEAR']), message: z.string().trim().min(5).max(300) }).strict() }), async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const b = req.body as { type: 'DELAYED' | 'EMERGENCY' | 'CLEAR'; message: string };
  const t = await prisma.trip.findFirst({ where: { id, transporterId: tid(req) }, select: { id: true, status: true, bookingId: true, tripCode: true, booking: { select: { companyId: true, bookingCode: true } } } });
  if (!t) throw AppError.notFound('Trip not found');
  await prisma.$transaction(async (tx) => {
    await tx.trip.update({ where: { id }, data: { exception: b.type === 'CLEAR' ? null : b.type } });
    await recordHistory(tx, id, t.status, t.status, actorOf(req), { remarks: `${b.type}: ${b.message}` });
    if (b.type === 'CLEAR') await tx.tripAlert.updateMany({ where: { tripId: id, type: { in: ['DELAYED_DELIVERY', 'EMERGENCY'] }, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: uid(req), resolutionNote: b.message } });
    else await tx.tripAlert.create({ data: { tripId: id, type: b.type === 'EMERGENCY' ? 'EMERGENCY' : 'DELAYED_DELIVERY', severity: b.type === 'EMERGENCY' ? 'CRITICAL' : 'MEDIUM', message: b.message } });
    await audit({ action: 'trip.issue_reported', entityType: 'trip', entityId: id, actorType: 'TRANSPORTER', actorUserId: uid(req), metadata: b, req }, tx);
  });
  if (b.type !== 'CLEAR') await notify({ companyId: t.booking.companyId, type: 'SUPPORT_UPDATE', title: `${b.type === 'EMERGENCY' ? 'Emergency' : 'Delay'} on ${t.booking.bookingCode}`, message: b.message, bookingId: t.bookingId, link: `/company/trips/${id}` });
  ok(res, 'Issue recorded', null);
});

transporterTripsRouter.post('/:id/alerts/:alertId/resolve', ...manageTrips, validateRequest({ params: z.object({ id: z.string().uuid(), alertId: z.string().uuid() }), body: z.object({ note: z.string().trim().min(3).max(500) }).strict() }), async (req: Request, res: Response) => {
  const t = await prisma.trip.findFirst({ where: { id: String(req.params.id), transporterId: tid(req) }, select: { id: true } });
  if (!t) throw AppError.notFound('Trip not found');
  const r = await prisma.tripAlert.updateMany({ where: { id: String(req.params.alertId), tripId: t.id, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: uid(req), resolutionNote: req.body.note } });
  if (r.count === 0) throw AppError.notFound('Alert not found');
  ok(res, 'Alert resolved', null);
});

// ---- External GPS hardware / telematics ------------------------------------------------------

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const gpsRouter = Router();
gpsRouter.post('/ingest', validateRequest({
  body: z.object({ deviceId: z.string().trim().min(1).max(60), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), speedKmph: z.number().min(0).max(250).optional(), heading: z.number().int().min(0).max(360).optional(), recordedAt: z.coerce.date() }).strict(),
}), async (req: Request, res: Response) => {
  const key = req.headers['x-gps-key'];
  if (!env.GPS_INGEST_KEY) throw AppError.notFound();
  if (typeof key !== 'string' || !safeEq(key, env.GPS_INGEST_KEY)) throw AppError.unauthorized('Invalid device key');
  const { deviceId, ...point } = req.body as { deviceId: string; latitude: number; longitude: number; speedKmph?: number; heading?: number; recordedAt: Date };
  const tanker = await prisma.tanker.findFirst({ where: { gpsDeviceId: deviceId }, select: { id: true } });
  if (!tanker) throw AppError.notFound('Unknown device');
  const trip = await prisma.trip.findFirst({ where: { tankerId: tanker.id, status: { in: ['DRIVER_ACCEPTED', 'REACHED_PICKUP', 'LOADING', 'LOADING_COMPLETED', 'IN_TRANSIT', 'REACHED_DESTINATION', 'UNLOADING_STARTED', 'UNLOADING_COMPLETED'] } }, select: { id: true } });
  if (!trip) {
    // Between trips the device still reports the tanker's position (no trip history is written).
    await prisma.tanker.update({ where: { id: tanker.id }, data: { currentLatitude: point.latitude, currentLongitude: point.longitude, lastLocationAt: point.recordedAt } });
    return ok(res, 'Position stored', { tripId: null });
  }
  await recordLocations(trip.id, [point], 'GPS_DEVICE');
  ok(res, 'Position stored', { tripId: trip.id });
});

