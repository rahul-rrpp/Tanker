import type { Prisma, TankerStatus } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticateUser } from '../../middleware/auth';
import { requireTransporter } from '../../middleware/transporter';
import { multipart, sendStoredFile } from '../../middleware/upload';
import { validateRequest } from '../../middleware/validate';
import { AppError, ErrorCode } from '../../utils/errors';
import { created, ok } from '../../utils/response';
import { audit } from '../audit/audit';
import { idParam, listKyc, notVerified, ownedDriver, ownedTanker, pageOf, parsePaging, saveKycDocument, tid, uid } from './common';
import { BUSY_TRIP } from './matching.service';

export const tankersRouter = Router();
tankersRouter.use(authenticateUser);
const view = requireTransporter({ permission: 'agency:read' });
const manage = requireTransporter({ permission: 'agency:fleet:manage' });

export const TANKER_DOC_TYPES = ['REGISTRATION_CERTIFICATE', 'INSURANCE', 'FITNESS_CERTIFICATE', 'PUC', 'PERMIT', 'PESO', 'OTHER'] as const;

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').transform((s) => new Date(`${s}T00:00:00Z`));
const REG = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/;

const tankerFields = z.object({
  vehicleMake: z.string().trim().min(2).max(60),
  vehicleModel: z.string().trim().min(1).max(60),
  manufacturingYear: z.number().int().min(1980).max(new Date().getUTCFullYear() + 1),
  capacityKl: z.number().positive().max(100),
  tankerTypeId: z.string().uuid('Select a tanker type'),
  compartments: z.number().int().min(1).max(12),
  compartmentCapacities: z.array(z.number().positive().max(100)).max(12).optional(),
  productIds: z.array(z.string().uuid()).min(1, 'Select at least one permitted product').max(50),
  gpsDeviceId: z.string().trim().max(60).optional().or(z.literal('').transform(() => undefined)),
  availableLocation: z.string().trim().max(200).optional().or(z.literal('').transform(() => undefined)),
  availableLatitude: z.number().min(-90).max(90).optional(),
  availableLongitude: z.number().min(-180).max(180).optional(),
  insuranceExpiry: dateOnly.optional(), fitnessExpiry: dateOnly.optional(), permitExpiry: dateOnly.optional(), pucExpiry: dateOnly.optional(), pesoExpiry: dateOnly.optional(),
  pesoLicenceNumber: z.string().trim().max(40).optional().or(z.literal('').transform(() => undefined)),
});

const compartmentsAddUp = (v: { compartments?: number; compartmentCapacities?: number[]; capacityKl?: number }, ctx: z.RefinementCtx) => {
  const c = v.compartmentCapacities;
  if (!c || c.length === 0) return;
  if (v.compartments !== undefined && c.length !== v.compartments) ctx.addIssue({ code: 'custom', path: ['compartmentCapacities'], message: 'Enter one capacity per compartment' });
  if (v.capacityKl !== undefined && Math.abs(c.reduce((a, b) => a + b, 0) - v.capacityKl) > 0.01) ctx.addIssue({ code: 'custom', path: ['compartmentCapacities'], message: 'Compartments must add up to the tanker capacity' });
};

const createSchema = tankerFields.extend({ registrationNumber: z.string().trim().toUpperCase().regex(REG, 'Enter a valid registration number, e.g. MH12AB1234') }).strict().superRefine(compartmentsAddUp);
const updateSchema = tankerFields.partial().strict().superRefine(compartmentsAddUp);

const listInclude = {
  tankerType: { select: { id: true, name: true } },
  products: { select: { product: { select: { id: true, name: true } } } },
  assignedDriver: { select: { id: true, user: { select: { fullName: true } } } },
  compartmentRows: { orderBy: { position: 'asc' } },
} satisfies Prisma.TankerInclude;

const shape = (t: Prisma.TankerGetPayload<{ include: typeof listInclude }>) => {
  const expiries = [t.insuranceExpiry, t.fitnessExpiry, t.permitExpiry, t.pucExpiry, t.pesoExpiry].filter((d): d is Date => Boolean(d));
  return {
    id: t.id, registrationNumber: t.registrationNumber, capacityKl: t.capacityKl.toNumber(), tankerType: t.tankerType, compartments: t.compartments, compartmentCapacities: t.compartmentRows.map((c) => c.capacityKl.toNumber()),
    products: t.products.map((p) => p.product), assignedDriver: t.assignedDriver ? { id: t.assignedDriver.id, name: t.assignedDriver.user.fullName } : null, status: t.status, verificationStatus: t.verificationStatus, rejectionReason: t.rejectionReason,
    vehicleMake: t.vehicleMake, vehicleModel: t.vehicleModel, manufacturingYear: t.manufacturingYear, gpsDeviceId: t.gpsDeviceId, isDemo: t.isDemo,
    insuranceExpiry: t.insuranceExpiry, fitnessExpiry: t.fitnessExpiry, permitExpiry: t.permitExpiry, pucExpiry: t.pucExpiry, pesoExpiry: t.pesoExpiry, pesoLicenceNumber: t.pesoLicenceNumber,
    nextDocumentExpiry: expiries.length ? new Date(Math.min(...expiries.map((d) => d.getTime()))) : null,
    availableFrom: t.availableFrom, availableLocation: t.availableLocation,
    currentLocation: t.currentLatitude ? { lat: t.currentLatitude.toNumber(), lng: t.currentLongitude!.toNumber(), at: t.lastLocationAt } : null,
  };
};

async function assertOptions(input: { tankerTypeId?: string; productIds?: string[] }) {
  if (input.tankerTypeId && !(await prisma.tankerType.count({ where: { id: input.tankerTypeId, isActive: true } }))) throw AppError.badRequest('Select a valid tanker type');
  if (input.productIds && (await prisma.product.count({ where: { id: { in: input.productIds }, isActive: true } })) !== new Set(input.productIds).size) throw AppError.badRequest('Select valid products');
}

tankersRouter.post('/', manage, validateRequest({ body: createSchema }), async (req: Request, res: Response) => {
  const { productIds, compartmentCapacities, ...data } = req.body as z.infer<typeof createSchema>;
  await assertOptions(req.body);
  const tanker = await prisma.$transaction(async (tx) => {
    const t = await tx.tanker.create({
      // Always starts unverified: compliance status is set only by the admin review.
      data: { ...data, transporterId: tid(req), status: 'AVAILABLE', verificationStatus: 'PENDING_VERIFICATION', products: { create: [...new Set(productIds)].map((productId) => ({ productId })) }, compartmentRows: compartmentCapacities?.length ? { create: compartmentCapacities.map((capacityKl, i) => ({ position: i + 1, capacityKl })) } : undefined },
      include: listInclude,
    });
    await audit({ action: 'tanker.created', entityType: 'tanker', entityId: t.id, actorType: 'TRANSPORTER', actorUserId: uid(req), metadata: { registrationNumber: t.registrationNumber }, req }, tx);
    return t;
  });
  created(res, 'Tanker added. Upload its documents for verification.', { tanker: shape(tanker) });
});

tankersRouter.get('/', view, async (req: Request, res: Response) => {
  const q = parsePaging(req);
  const search = typeof req.query.q === 'string' ? req.query.q.trim().toUpperCase() : '';
  const status = typeof req.query.status === 'string' && req.query.status ? (req.query.status as TankerStatus) : undefined;
  const where: Prisma.TankerWhereInput = { transporterId: tid(req), ...(search ? { registrationNumber: { contains: search } } : {}), ...(status ? { status } : {}) };
  const [total, rows] = await Promise.all([prisma.tanker.count({ where }), prisma.tanker.findMany({ where, include: listInclude, orderBy: { createdAt: 'desc' }, ...pageOf(q) })]);
  ok(res, 'Tankers', { total, page: q.page, pageSize: q.pageSize, items: rows.map(shape) });
});

tankersRouter.get('/availability/calendar', view, async (req: Request, res: Response) => {
  const from = new Date(String(req.query.from ?? new Date().toISOString().slice(0, 10)) + 'T00:00:00Z');
  const to = new Date(from.getTime() + 35 * 86400_000);
  const tankers = await prisma.tanker.findMany({
    where: { transporterId: tid(req) },
    orderBy: { registrationNumber: 'asc' },
    select: {
      id: true, registrationNumber: true, status: true, capacityKl: true, availableFrom: true, availableLocation: true, verificationStatus: true,
      availabilityBlocks: { where: { cancelledAt: null, endAt: { gte: from }, startAt: { lte: to } }, orderBy: { startAt: 'asc' }, select: { id: true, kind: true, startAt: true, endAt: true, note: true } },
      trips: { where: { status: { in: BUSY_TRIP }, OR: [{ plannedStartAt: null }, { plannedEndAt: { gte: from }, plannedStartAt: { lte: to } }] }, select: { id: true, tripCode: true, status: true, plannedStartAt: true, plannedEndAt: true, booking: { select: { bookingCode: true, locations: { select: { type: true, city: true } } } } } },
    },
  });
  ok(res, 'Availability', { from, to, tankers: tankers.map((t) => ({ ...t, capacityKl: t.capacityKl.toNumber() })) });
});

tankersRouter.get('/:id', view, idParam, async (req: Request, res: Response) => {
  await ownedTanker(tid(req), String(req.params.id));
  const id = String(req.params.id);
  const [t, documents, trips] = await Promise.all([
    prisma.tanker.findUniqueOrThrow({ where: { id }, include: listInclude }),
    listKyc('TANKER', id),
    prisma.trip.findMany({ where: { tankerId: id }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, tripCode: true, status: true, createdAt: true, completedAt: true, booking: { select: { id: true, bookingCode: true, product: { select: { name: true } }, locations: { select: { type: true, city: true } } } }, driver: { select: { user: { select: { fullName: true } } } } } }),
  ]);
  ok(res, 'Tanker', { tanker: shape(t), documents, trips });
});

tankersRouter.put('/:id', manage, idParam, validateRequest({ body: updateSchema }), async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const before = await ownedTanker(tid(req), id);
  const { productIds, compartmentCapacities, ...data } = req.body as z.infer<typeof updateSchema>;
  await assertOptions(req.body);
  // Changing what a verified tanker is certified to be sends it back for review.
  const material = data.capacityKl !== undefined || data.tankerTypeId !== undefined || productIds !== undefined || compartmentCapacities !== undefined || data.compartments !== undefined;
  const reVerify = material && before.verificationStatus === 'APPROVED';
  await prisma.$transaction(async (tx) => {
    if (productIds) {
      await tx.tankerProduct.deleteMany({ where: { tankerId: id } });
      await tx.tankerProduct.createMany({ data: [...new Set(productIds)].map((productId) => ({ tankerId: id, productId })) });
    }
    if (compartmentCapacities) {
      await tx.tankerCompartment.deleteMany({ where: { tankerId: id } });
      await tx.tankerCompartment.createMany({ data: compartmentCapacities.map((capacityKl, i) => ({ tankerId: id, position: i + 1, capacityKl })) });
    }
    await tx.tanker.update({ where: { id }, data: { ...data, ...(reVerify ? { verificationStatus: 'UNDER_REVIEW' as const } : {}) } });
    await audit({ action: 'tanker.updated', entityType: 'tanker', entityId: id, actorType: 'TRANSPORTER', actorUserId: uid(req), newValue: req.body, metadata: { reVerify }, req }, tx);
  });
  ok(res, reVerify ? 'Saved. These changes need re-verification.' : 'Tanker saved', { tanker: shape(await prisma.tanker.findUniqueOrThrow({ where: { id }, include: listInclude })) });
});

tankersRouter.post('/:id/documents', manage, idParam, multipart({ field: 'file' }), async (req: Request, res: Response) => {
  await ownedTanker(tid(req), String(req.params.id));
  const d = await saveKycDocument(req, { type: 'TANKER', id: String(req.params.id), transporterId: tid(req) }, TANKER_DOC_TYPES);
  created(res, 'Document uploaded', { document: { id: d.id, docType: d.docType, status: d.status } });
});

tankersRouter.get('/:id/documents/:docId/download', view, validateRequest({ params: z.object({ id: z.string().uuid(), docId: z.string().uuid() }) }), async (req: Request, res: Response) => {
  await ownedTanker(tid(req), String(req.params.id));
  const d = await prisma.kycDocument.findFirst({ where: { id: String(req.params.docId), ownerType: 'TANKER', ownerId: String(req.params.id) } });
  if (!d) throw AppError.notFound('Document not found');
  sendStoredFile(res, d, req.query.inline === '1');
});

tankersRouter.post('/:id/assign-driver', manage, idParam, validateRequest({ body: z.object({ driverId: z.string().uuid().nullable() }).strict() }), async (req: Request, res: Response) => {
  const id = String(req.params.id);
  await ownedTanker(tid(req), id);
  const driverId = req.body.driverId as string | null;
  if (driverId) {
    const d = await ownedDriver(tid(req), driverId);
    if (d.verificationStatus !== 'APPROVED') throw notVerified('This driver');
    if (!d.isActive) throw AppError.conflict('This driver is inactive', ErrorCode.NOT_COMPLIANT);
    await prisma.tanker.updateMany({ where: { assignedDriverId: driverId, id: { not: id } }, data: { assignedDriverId: null } });
  }
  await prisma.tanker.update({ where: { id }, data: { assignedDriverId: driverId } });
  await audit({ action: 'tanker.driver_assigned', entityType: 'tanker', entityId: id, actorType: 'TRANSPORTER', actorUserId: uid(req), metadata: { driverId }, req });
  ok(res, driverId ? 'Driver assigned' : 'Driver removed', null);
});

// Only these are transporter-settable. BOOKED / LOADING / IN_TRANSIT come from trips, SUSPENDED from admin.
const SETTABLE = ['AVAILABLE', 'MAINTENANCE', 'UNAVAILABLE'] as const;

const availabilitySchema = z
  .object({
    status: z.enum(SETTABLE).optional(),
    availableFrom: z.coerce.date().optional(),
    availableLocation: z.string().trim().max(200).optional(),
    availableLatitude: z.number().min(-90).max(90).optional(),
    availableLongitude: z.number().min(-180).max(180).optional(),
    block: z.object({ kind: z.enum(['BLOCKED', 'MAINTENANCE']), startAt: z.coerce.date(), endAt: z.coerce.date(), note: z.string().trim().max(300).optional() }).strict().refine((b) => b.endAt > b.startAt, 'End must be after start').optional(),
    cancelBlockId: z.string().uuid().optional(),
  })
  .strict();

tankersRouter.put('/:id/availability', manage, idParam, validateRequest({ body: availabilitySchema }), async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const t = await ownedTanker(tid(req), id);
  const { status, block, cancelBlockId, ...location } = req.body as z.infer<typeof availabilitySchema>;
  if (t.status === 'SUSPENDED') throw AppError.conflict('This tanker is suspended by TankerLink', ErrorCode.NOT_COMPLIANT);
  const active = await prisma.trip.findMany({ where: { tankerId: id, status: { in: BUSY_TRIP } }, select: { tripCode: true, plannedStartAt: true, plannedEndAt: true } });
  if (status && status !== 'AVAILABLE' && active.length) throw AppError.conflict(`Tanker is assigned to ${active[0].tripCode}. Reassign that trip first.`, ErrorCode.RESOURCE_CONFLICT);
  if (status === 'AVAILABLE' && active.length) throw AppError.conflict('Tanker status follows its current trip', ErrorCode.RESOURCE_CONFLICT);
  if (block) {
    const clash = active.find((a) => !a.plannedStartAt || !a.plannedEndAt || (a.plannedStartAt < block.endAt && a.plannedEndAt > block.startAt));
    if (clash) throw AppError.conflict(`These dates overlap trip ${clash.tripCode}`, ErrorCode.RESOURCE_CONFLICT);
  }
  await prisma.$transaction(async (tx) => {
    if (block) await tx.tankerAvailability.create({ data: { ...block, tankerId: id, createdById: uid(req) } });
    if (cancelBlockId) {
      const r = await tx.tankerAvailability.updateMany({ where: { id: cancelBlockId, tankerId: id, cancelledAt: null }, data: { cancelledAt: new Date() } });
      if (r.count === 0) throw AppError.notFound('Block not found');
    }
    await tx.tanker.update({ where: { id }, data: { ...location, ...(status ? { status } : {}) } });
    await audit({ action: 'tanker.availability_changed', entityType: 'tanker', entityId: id, actorType: 'TRANSPORTER', actorUserId: uid(req), newValue: { status: status ?? null, block: block ? { kind: block.kind } : null, cancelBlockId: cancelBlockId ?? null }, req }, tx);
  });
  ok(res, 'Availability updated', null);
});
