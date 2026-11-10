import type { Prisma, TripDocumentType } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { storage } from '../../lib/storage';
import { authenticateUser } from '../../middleware/auth';
import { requireDriver } from '../../middleware/transporter';
import { multipart, sendStoredFile, storeUpload } from '../../middleware/upload';
import { validateRequest } from '../../middleware/validate';
import { AppError, ErrorCode } from '../../utils/errors';
import { created, ok } from '../../utils/response';
import { audit } from '../audit/audit';
import { lockBooking } from '../bookings/booking.common';
import { notifyTransporter } from '../notifications/notification.service';
import { idParam, listKyc } from './common';
import { recordLocations } from './tracking.service';
import { announce, DRIVER_ACTIONS, recordHistory, TRACKABLE, transition, type DriverAction } from './trip.engine';

/**
 * Driver sub-login. Every query is scoped by req.driver.id, so a driver reaches only trips assigned to
 * them. Nothing here returns freight, commission, offers or other drivers' data.
 */
export const driverRouter = Router();
driverRouter.use(authenticateUser, requireDriver);

const did = (req: Request) => req.driver!.id;
const uid = (req: Request) => req.auth!.principal.userId;
const actor = (req: Request) => ({ type: 'DRIVER' as const, userId: uid(req) });

// No money fields, by construction.
const tripSelect = {
  id: true, tripCode: true, status: true, exception: true, etaAt: true, lastGpsAt: true, isSimulated: true, plannedStartAt: true, plannedEndAt: true, driverAcceptedAt: true, deliveredAt: true, completedAt: true, plannedDistanceKm: true, distanceTravelledKm: true,
  tanker: { select: { registrationNumber: true, capacityKl: true, compartments: true } },
  booking: { select: { bookingCode: true, routePolyline: true, durationMinutes: true, loadingDate: true, loadingTime: true, expectedDeliveryDate: true, loadingContactName: true, loadingContactPhone: true, loadingInstructions: true, deliveryContactName: true, deliveryContactPhone: true, deliveryInstructions: true, product: { select: { name: true } }, requirement: { select: { quantityKl: true } }, locations: { select: { type: true, address: true, city: true, latitude: true, longitude: true } } } },
} satisfies Prisma.TripSelect;
type Row = Prisma.TripGetPayload<{ select: typeof tripSelect }>;

const nextActionFor = (status: string) => (Object.entries(DRIVER_ACTIONS) as [DriverAction, { from: string; to: string }][]).find(([, a]) => a.from === status)?.[0] ?? null;

const shape = (t: Row) => {
  const loc = (type: string) => {
    const l = t.booking.locations.find((x) => x.type === type);
    return l ? { address: l.address, city: l.city, lat: l.latitude.toNumber(), lng: l.longitude.toNumber() } : null;
  };
  const { booking: b, ...rest } = t;
  return {
    ...rest, plannedDistanceKm: t.plannedDistanceKm.toNumber(), distanceTravelledKm: t.distanceTravelledKm.toNumber(), tanker: t.tanker ? { ...t.tanker, capacityKl: t.tanker.capacityKl.toNumber() } : null,
    bookingCode: b.bookingCode, product: b.product.name, quantityKl: b.requirement?.quantityKl.toNumber(), routePolyline: b.routePolyline, durationMinutes: b.durationMinutes, loadingDate: b.loadingDate, loadingTime: b.loadingTime, expectedDeliveryDate: b.expectedDeliveryDate,
    loadingContact: { name: b.loadingContactName, phone: b.loadingContactPhone }, deliveryContact: { name: b.deliveryContactName, phone: b.deliveryContactPhone }, loadingInstructions: b.loadingInstructions, deliveryInstructions: b.deliveryInstructions,
    pickup: loc('PICKUP'), delivery: loc('DELIVERY'), nextAction: nextActionFor(t.status), locationSharingAllowed: TRACKABLE.includes(t.status),
  };
};

driverRouter.get('/me', async (req, res) => {
  const d = await prisma.driver.findUniqueOrThrow({
    where: { id: did(req) },
    select: { id: true, licenceNumber: true, licenceType: true, licenceExpiry: true, hazardousTraining: true, hazardousTrainingExpiry: true, verificationStatus: true, emergencyContactName: true, emergencyContactPhone: true, address: true, user: { select: { fullName: true, phone: true, email: true } }, agency: { select: { companyName: true, owner: { select: { phone: true } } } }, assignedTanker: { select: { registrationNumber: true, capacityKl: true } } },
  });
  const current = await prisma.trip.findFirst({ where: { driverId: did(req), status: { in: ['DRIVER_ASSIGNED', ...TRACKABLE] } }, orderBy: { plannedStartAt: 'asc' }, select: tripSelect });
  const upcoming = await prisma.trip.count({ where: { driverId: did(req), status: { in: ['DRIVER_ASSIGNED', ...TRACKABLE] } } });
  ok(res, 'Driver', {
    driver: { ...d, fullName: d.user.fullName, phone: d.user.phone, email: d.user.email, user: undefined, transporter: d.agency.companyName, transporterPhone: d.agency.owner.phone, agency: undefined, assignedTanker: d.assignedTanker ? { ...d.assignedTanker, capacityKl: d.assignedTanker.capacityKl.toNumber() } : null },
    currentTrip: current ? shape(current) : null,
    upcoming,
    documents: await listKyc('DRIVER', did(req)),
  });
});

driverRouter.get('/me/trips', async (req: Request, res: Response) => {
  const scope = req.query.scope === 'history' ? ['DELIVERED', 'COMPLETED', 'CANCELLED'] : ['DRIVER_ASSIGNED', ...TRACKABLE];
  const rows = await prisma.trip.findMany({ where: { driverId: did(req), status: { in: scope as Prisma.EnumTripStatusFilter['in'] } }, select: tripSelect, orderBy: { plannedStartAt: 'asc' }, take: 100 });
  ok(res, 'Trips', { items: rows.map(shape) });
});

async function myTrip(req: Request) {
  const t = await prisma.trip.findFirst({ where: { id: String(req.params.id), driverId: did(req) }, select: { id: true, bookingId: true, transporterId: true, status: true, allocationId: true, tankerId: true, tripCode: true } });
  // Not assigned to this driver: 404, so other trips cannot be probed.
  if (!t) throw AppError.notFound('Trip not found');
  return t;
}

driverRouter.get('/me/trips/:id', idParam, async (req: Request, res: Response) => {
  const ref = await myTrip(req);
  const t = await prisma.trip.findUniqueOrThrow({ where: { id: ref.id }, select: tripSelect });
  const [documents, history] = await Promise.all([
    prisma.tripDocument.findMany({ where: { tripId: ref.id }, orderBy: { createdAt: 'desc' }, select: { id: true, type: true, title: true, fileName: true, mimeType: true, createdAt: true } }),
    prisma.tripStatusHistory.findMany({ where: { tripId: ref.id }, orderBy: { createdAt: 'asc' }, select: { id: true, fromStatus: true, toStatus: true, reason: true, createdAt: true, actorType: true } }),
  ]);
  ok(res, 'Trip', { trip: shape(t), documents, history });
});

const point = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });

driverRouter.post('/me/trips/:id/status', idParam, validateRequest({
  body: z.object({ action: z.enum(Object.keys(DRIVER_ACTIONS) as [DriverAction, ...DriverAction[]]), remarks: z.string().trim().max(500).optional() }).merge(point.partial()).strict(),
}), async (req: Request, res: Response) => {
  const ref = await myTrip(req);
  const body = req.body as { action: DriverAction; remarks?: string; latitude?: number; longitude?: number };
  const step = DRIVER_ACTIONS[body.action];
  await prisma.$transaction(async (tx) => {
    await lockBooking(tx, ref.bookingId);
    const trip = await tx.trip.findUniqueOrThrow({ where: { id: ref.id } });
    if (trip.driverId !== did(req)) throw AppError.notFound('Trip not found');
    if (trip.status !== step.from) throw AppError.conflict(`This step is not available while the trip is ${trip.status.replace(/_/g, ' ').toLowerCase()}`, ErrorCode.INVALID_STATE_TRANSITION);
    if (step.to === 'DELIVERED' && !(await tx.tripDocument.count({ where: { tripId: trip.id, type: 'DELIVERY_PROOF' } }))) {
      throw AppError.conflict('Upload the delivery proof before submitting completion', ErrorCode.INVALID_STATE_TRANSITION);
    }
    const now = new Date();
    const stamps: Prisma.TripUncheckedUpdateInput = {
      ...(step.to === 'DRIVER_ACCEPTED' ? { driverAcceptedAt: now } : {}),
      ...(step.to === 'LOADING' ? { startedAt: now } : {}),
      ...(step.to === 'LOADING_COMPLETED' ? { loadedAt: now } : {}),
      ...(step.to === 'DELIVERED' ? { deliveredAt: now } : {}),
    };
    await transition(tx, trip, step.to, actor(req), { remarks: body.remarks, latitude: body.latitude, longitude: body.longitude, req, data: stamps });
  });
  await announce(ref, step.to);
  ok(res, 'Trip updated', { status: step.to, nextAction: nextActionFor(step.to) });
});

const DOC_TYPES = ['DELIVERY_PROOF', 'LOADING_SLIP', 'LORRY_RECEIPT', 'E_WAY_BILL', 'OTHER'] as const;

driverRouter.post('/me/trips/:id/documents', idParam, multipart({ field: 'file' }), async (req: Request, res: Response) => {
  const ref = await myTrip(req);
  const input = z.object({ type: z.enum(DOC_TYPES), title: z.string().trim().max(120).optional() }).strict().parse(req.body ?? {});
  if (ref.status === 'COMPLETED' || ref.status === 'CANCELLED') throw AppError.conflict('This trip is closed', ErrorCode.INVALID_STATE_TRANSITION);
  const file = await storeUpload(req.file, 'trip-documents', ['pdf', 'png', 'jpeg']);
  try {
    const doc = await prisma.tripDocument.create({ data: { tripId: ref.id, bookingId: ref.bookingId, type: input.type as TripDocumentType, title: input.title ?? input.type.replace(/_/g, ' ').toLowerCase(), uploadedById: uid(req), ...file }, select: { id: true, type: true, title: true, fileName: true, createdAt: true } });
    await audit({ action: 'trip.document_uploaded', entityType: 'trip', entityId: ref.id, actorType: 'DRIVER', actorUserId: uid(req), metadata: { type: input.type }, req });
    created(res, 'Document uploaded', { document: doc });
  } catch (e) {
    await storage.remove(file.storageKey);
    throw e;
  }
});

driverRouter.get('/me/trips/:id/documents/:docId/download', validateRequest({ params: z.object({ id: z.string().uuid(), docId: z.string().uuid() }) }), async (req: Request, res: Response) => {
  const ref = await myTrip(req);
  const d = await prisma.tripDocument.findFirst({ where: { id: String(req.params.docId), tripId: ref.id } });
  if (!d) throw AppError.notFound('Document not found');
  sendStoredFile(res, d, req.query.inline === '1');
});

const locationSchema = z.object({
  points: z.array(point.extend({ speedKmph: z.number().min(0).max(250).nullish().transform((v) => v ?? undefined), heading: z.number().min(0).max(360).nullish().transform((v) => (v == null ? undefined : Math.round(v))), recordedAt: z.coerce.date() }).strict()).min(1).max(200),
}).strict();

driverRouter.post('/me/trips/:id/location', idParam, validateRequest({ body: locationSchema }), async (req: Request, res: Response) => {
  const ref = await myTrip(req);
  ok(res, 'Location stored', await recordLocations(ref.id, (req.body as z.infer<typeof locationSchema>).points, 'DRIVER_APP'));
});

driverRouter.post('/me/trips/:id/emergency', idParam, validateRequest({ body: z.object({ message: z.string().trim().min(3).max(300) }).merge(point.partial()).strict() }), async (req: Request, res: Response) => {
  const ref = await myTrip(req);
  const b = req.body as { message: string; latitude?: number; longitude?: number };
  await prisma.$transaction(async (tx) => {
    await tx.trip.update({ where: { id: ref.id }, data: { exception: 'EMERGENCY' } });
    await tx.tripAlert.create({ data: { tripId: ref.id, type: 'EMERGENCY', severity: 'CRITICAL', message: b.message } });
    await recordHistory(tx, ref.id, ref.status, ref.status, actor(req), { remarks: `EMERGENCY: ${b.message}`, latitude: b.latitude, longitude: b.longitude });
  });
  await notifyTransporter(ref.transporterId, { type: 'ADMIN_ALERT', title: `EMERGENCY on ${ref.tripCode}`, message: b.message, bookingId: ref.bookingId, link: `/transporter/trips/${ref.id}` });
  ok(res, 'Your transporter has been alerted', null);
});
