import type { Prisma, TankerStatus } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError, ErrorCode } from '../../utils/errors';
import { created, ok } from '../../utils/response';
import { fullNameSchema, phoneSchema } from '../../utils/validators';
import { audit } from '../audit/audit';
import { adminAuth, assignedIds, body, can, dateRange, idOf, insensitive, orderBy, parseList, recordReview, respondList, win, type Column } from './core';
import { reviewHistory } from './parties.routes';

const reviewSchema = z.object({ action: z.enum(['START_REVIEW', 'APPROVE', 'REJECT']), reason: z.string().trim().max(500).optional() }).strict();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((s) => new Date(`${s}T00:00:00Z`));
const optDate = dateOnly.nullable().optional();

async function needPerm(req: Request, res: Response, module: 'drivers' | 'tankers', action: 'approve' | 'reject' | 'edit') {
  await new Promise<void>((resolve, reject) => can(module, action)(req, res, (e?: unknown) => (e ? reject(e) : resolve())));
}

/** Drivers/tankers of transporters outside an ASSIGNED-scope employee's portfolio are invisible. */
async function transporterScope(req: Request) {
  return assignedIds(req, 'TRANSPORTER');
}

// ===========================================================================
// Drivers (always linked to a transporter)
// ===========================================================================

export const adminDriversRouter = Router();
adminDriversRouter.use(...adminAuth);

const driverColumns: Column[] = [
  { key: 'code', label: 'Driver ID', format: 'text' },
  { key: 'name', label: 'Driver name', format: 'text' },
  { key: 'phone', label: 'Mobile', format: 'text' },
  { key: 'transporter', label: 'Transporter', format: 'text' },
  { key: 'tanker', label: 'Assigned tanker', format: 'text' },
  { key: 'licenceNumber', label: 'Licence number', format: 'text' },
  { key: 'licenceExpiry', label: 'Licence expiry', format: 'date' },
  { key: 'hazardousTraining', label: 'Hazardous training', format: 'text' },
  { key: 'verificationStatus', label: 'Verification', format: 'text' },
  { key: 'activeTrip', label: 'Active trip', format: 'text' },
  { key: 'driverStatus', label: 'Driver status', format: 'text' },
];

const ACTIVE_TRIP = ['VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'REACHED_PICKUP', 'LOADING', 'LOADING_COMPLETED', 'IN_TRANSIT', 'REACHED_DESTINATION', 'UNLOADING_STARTED', 'UNLOADING_COMPLETED'] as const;

adminDriversRouter.get('/', can('drivers', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { transporterId: z.string().uuid().optional(), status: z.string().optional(), hazardous: z.string().optional(), expiring: z.enum(['true']).optional() });
  const scope = await transporterScope(req);
  const where: Prisma.DriverWhereInput = {
    ...(scope ? { agencyId: { in: scope } } : {}),
    ...(q.transporterId ? { agencyId: q.transporterId as string } : {}),
    ...(q.status ? { verificationStatus: q.status as never } : {}),
    ...(q.hazardous ? { hazardousTraining: q.hazardous as never } : {}),
    ...(q.expiring ? { licenceExpiry: { lte: new Date(Date.now() + 30 * 86400_000) } } : {}),
    ...(q.from || q.to ? { createdAt: dateRange(q) } : {}),
    ...(q.q ? { OR: [{ licenceNumber: insensitive(q.q) }, { user: { fullName: insensitive(q.q) } }, { user: { phone: { contains: q.q } } }] } : {}),
  };
  const load = async (paged: boolean) => {
    const rows = await prisma.driver.findMany({
      where,
      orderBy: orderBy(q, ['createdAt', 'licenceExpiry'], 'createdAt'),
      ...win(q, paged),
      include: {
        user: { select: { fullName: true, phone: true, accountStatus: true } },
        agency: { select: { id: true, companyName: true } },
        assignedTanker: { select: { id: true, registrationNumber: true } },
        trips: { where: { status: { in: [...ACTIVE_TRIP] } }, select: { id: true, tripCode: true }, take: 1 },
      },
    });
    return rows.map((d) => ({
      id: d.id,
      code: `DRV-${d.id.slice(0, 8).toUpperCase()}`,
      name: d.user.fullName,
      phone: d.user.phone,
      transporter: d.agency.companyName,
      transporterId: d.agency.id,
      tanker: d.assignedTanker?.registrationNumber ?? null,
      licenceNumber: d.licenceNumber,
      licenceType: d.licenceType,
      licenceExpiry: d.licenceExpiry,
      hazardousTraining: d.hazardousTraining,
      verificationStatus: d.verificationStatus,
      activeTrip: d.trips[0]?.tripCode ?? null,
      driverStatus: d.user.accountStatus,
      isDemo: d.isDemo,
    }));
  };
  const [total, rows] = await Promise.all([prisma.driver.count({ where }), load(true)]);
  await respondList(req, res, { title: 'Drivers', q, columns: driverColumns, total, rows, exportRows: () => load(false), module: 'drivers' });
});

const driverSchema = z.object({
  transporterId: z.string().uuid(),
  fullName: fullNameSchema,
  phone: phoneSchema,
  licenceNumber: z.string().trim().toUpperCase().transform((v) => v.replace(/[\s-]/g, '')).pipe(z.string().regex(/^[A-Z]{2}\d{2}\d{4}\d{7}$/, 'Enter a valid licence number, e.g. MH1420110012345')),
  licenceType: z.enum(['LMV', 'HMV', 'HGMV', 'HTV', 'TRANS']),
  licenceExpiry: dateOnly,
  hazardousTraining: z.enum(['NOT_PROVIDED', 'PENDING', 'VALID', 'EXPIRED', 'NOT_REQUIRED']).default('NOT_PROVIDED'),
  hazardousTrainingExpiry: optDate,
});

adminDriversRouter.post('/', can('drivers', 'create'), async (req: Request, res: Response) => {
  const input = body(req, driverSchema);
  const t = await prisma.agency.findUnique({ where: { id: input.transporterId } });
  if (!t) throw AppError.badRequest('Select the transporter this driver works for');
  if (await prisma.user.findUnique({ where: { phone: input.phone } })) throw AppError.conflict('This mobile number is already registered', ErrorCode.PHONE_ALREADY_REGISTERED);
  if (await prisma.driver.findUnique({ where: { licenceNumber: input.licenceNumber } })) throw AppError.conflict('This driving licence is already registered');
  const roleId = (await prisma.role.findUniqueOrThrow({ where: { name: 'DRIVER' } })).id;
  const driver = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { fullName: input.fullName, phone: input.phone, accountStatus: 'ACTIVE', roles: { create: { roleId } } } });
    const d = await tx.driver.create({
      data: { userId: user.id, agencyId: t.id, licenceNumber: input.licenceNumber, licenceType: input.licenceType, licenceExpiry: input.licenceExpiry, hazardousTraining: input.hazardousTraining, hazardousTrainingExpiry: input.hazardousTrainingExpiry ?? null },
    });
    await tx.agencyMember.create({ data: { agencyId: t.id, userId: user.id, role: 'DRIVER' } });
    await tx.driverTransporterHistory.create({ data: { driverId: d.id, transporterId: t.id, reason: 'Registered by admin' } });
    await audit({ action: 'driver.created_by_admin', entityType: 'driver', entityId: d.id, module: 'drivers', newValue: { name: input.fullName, transporter: t.companyName }, req }, tx);
    return d;
  });
  created(res, 'Driver added (pending verification)', { driver });
});

async function driverOr404(req: Request) {
  const id = idOf(req);
  const d = await prisma.driver.findUnique({ where: { id }, include: { user: true, agency: { select: { id: true, companyName: true } } } });
  if (!d) throw AppError.notFound('Driver not found');
  const scope = await transporterScope(req);
  if (scope && !scope.includes(d.agencyId)) throw AppError.notFound('Driver not found');
  return d;
}

adminDriversRouter.get('/:id', can('drivers', 'view'), async (req: Request, res: Response) => {
  const d = await driverOr404(req);
  const [trips, documents, history, reviews, tanker] = await Promise.all([
    prisma.trip.findMany({ where: { driverId: d.id }, orderBy: { createdAt: 'desc' }, take: 100, include: { booking: { select: { id: true, bookingCode: true } }, tanker: { select: { registrationNumber: true } } } }),
    prisma.kycDocument.findMany({ where: { ownerType: 'DRIVER', ownerId: d.id }, orderBy: { createdAt: 'desc' } }),
    prisma.driverTransporterHistory.findMany({ where: { driverId: d.id }, orderBy: { fromDate: 'desc' }, include: { transporter: { select: { companyName: true } } } }),
    reviewHistory('DRIVER', d.id),
    prisma.tanker.findUnique({ where: { assignedDriverId: d.id }, select: { id: true, registrationNumber: true, capacityKl: true, status: true } }),
  ]);
  const delivered = trips.filter((t) => t.status === 'DELIVERED' || t.status === 'COMPLETED').length;
  const delayed = await prisma.tripAlert.count({ where: { type: 'DELAYED_DELIVERY', tripId: { in: trips.map((t) => t.id) } } });
  ok(res, 'Driver', {
    driver: { id: d.id, name: d.user.fullName, phone: d.user.phone, accountStatus: d.user.accountStatus, licenceNumber: d.licenceNumber, licenceType: d.licenceType, licenceExpiry: d.licenceExpiry, hazardousTraining: d.hazardousTraining, hazardousTrainingExpiry: d.hazardousTrainingExpiry, verificationStatus: d.verificationStatus, rejectionReason: d.rejectionReason, transporter: d.agency, isDemo: d.isDemo, createdAt: d.createdAt },
    tanker,
    trips,
    documents,
    transporterHistory: history,
    verificationHistory: reviews,
    performance: { trips: trips.length, delivered, delayed, onTimeRate: delivered ? Math.round(((delivered - delayed) / delivered) * 1000) / 10 : null },
  });
});

adminDriversRouter.put('/:id', can('drivers', 'edit'), async (req: Request, res: Response) => {
  const d = await driverOr404(req);
  const input = body(req, driverSchema.omit({ transporterId: true, phone: true }).partial().strict());
  const updated = await prisma.$transaction(async (tx) => {
    if (input.fullName) await tx.user.update({ where: { id: d.userId }, data: { fullName: input.fullName } });
    const { fullName: _n, ...rest } = input;
    const u = await tx.driver.update({ where: { id: d.id }, data: rest });
    await audit({ action: 'driver.updated_by_admin', entityType: 'driver', entityId: d.id, module: 'drivers', previousValue: { licenceExpiry: d.licenceExpiry, hazardousTraining: d.hazardousTraining }, newValue: input as Prisma.InputJsonValue, req }, tx);
    return u;
  });
  ok(res, 'Driver updated', { driver: updated });
});

adminDriversRouter.post('/:id/review', async (req: Request, res: Response) => {
  const { action, reason } = body(req, reviewSchema);
  await needPerm(req, res, 'drivers', action === 'REJECT' ? 'reject' : action === 'APPROVE' ? 'approve' : 'edit');
  const d = await driverOr404(req);
  if (action === 'REJECT' && (!reason || reason.length < 5)) throw AppError.badRequest('A rejection reason is required', ErrorCode.VALIDATION_ERROR, [{ field: 'reason', message: 'Explain why' }]);
  if (action === 'APPROVE' && d.licenceExpiry.getTime() < Date.now()) throw AppError.conflict('Driving licence has expired; update it before approval');
  const to = action === 'START_REVIEW' ? 'UNDER_REVIEW' : action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  await prisma.$transaction(async (tx) => {
    await tx.driver.update({ where: { id: d.id }, data: { verificationStatus: to, rejectionReason: to === 'REJECTED' ? reason : null } });
    await recordReview(tx, { entityType: 'DRIVER', entityId: d.id, fromStatus: d.verificationStatus, toStatus: to, reason, reviewerId: req.admin!.userId });
    await audit({ action: `driver.${to.toLowerCase()}`, entityType: 'driver', entityId: d.id, module: 'drivers', previousValue: { status: d.verificationStatus }, newValue: { status: to, reason: reason ?? null }, req }, tx);
  });
  ok(res, `Driver ${to.toLowerCase().replace('_', ' ')}`, { status: to });
});

for (const [path, to] of [['suspend', 'SUSPENDED'], ['reactivate', 'ACTIVE']] as const) {
  adminDriversRouter.post(`/:id/${path}`, can('drivers', 'approve'), async (req: Request, res: Response) => {
    const d = await driverOr404(req);
    const { reason } = body(req, z.object({ reason: z.string().trim().max(500).optional() }));
    if (to === 'SUSPENDED' && (!reason || reason.length < 5)) throw AppError.badRequest('Give a reason for the suspension');
    if (d.user.accountStatus === to) throw AppError.conflict(`Driver is already ${to.toLowerCase()}`);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: d.userId }, data: { accountStatus: to } });
      if (to === 'SUSPENDED') {
        await tx.refreshSession.updateMany({ where: { userId: d.userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'DRIVER_SUSPENDED' } });
        await tx.tanker.updateMany({ where: { assignedDriverId: d.id }, data: { assignedDriverId: null } });
      }
      await recordReview(tx, { entityType: 'DRIVER', entityId: d.id, fromStatus: d.user.accountStatus, toStatus: to, reason, reviewerId: req.admin!.userId });
      await audit({ action: `driver.${path}ed`, entityType: 'driver', entityId: d.id, module: 'drivers', previousValue: { accountStatus: d.user.accountStatus }, newValue: { accountStatus: to, reason: reason ?? null }, req }, tx);
    });
    ok(res, to === 'SUSPENDED' ? 'Driver suspended' : 'Driver reactivated', null);
  });
}

/** Moves a driver to another transporter, preserving the employment history. */
adminDriversRouter.post('/:id/transfer', can('drivers', 'edit'), async (req: Request, res: Response) => {
  const d = await driverOr404(req);
  const { transporterId, reason } = body(req, z.object({ transporterId: z.string().uuid(), reason: z.string().trim().min(3).max(300) }));
  if (transporterId === d.agencyId) throw AppError.badRequest('Driver already works for this transporter');
  const active = await prisma.trip.count({ where: { driverId: d.id, status: { in: [...ACTIVE_TRIP] } } });
  if (active) throw AppError.conflict('Driver is on an active trip; transfer after it completes', ErrorCode.INVALID_STATE_TRANSITION);
  const t = await prisma.agency.findUnique({ where: { id: transporterId } });
  if (!t) throw AppError.badRequest('Transporter not found');
  await prisma.$transaction(async (tx) => {
    await tx.driverTransporterHistory.updateMany({ where: { driverId: d.id, toDate: null }, data: { toDate: new Date() } });
    if ((await tx.driverTransporterHistory.count({ where: { driverId: d.id } })) === 0) {
      await tx.driverTransporterHistory.create({ data: { driverId: d.id, transporterId: d.agencyId, fromDate: d.createdAt, toDate: new Date(), reason: 'Initial employment' } });
    }
    await tx.driverTransporterHistory.create({ data: { driverId: d.id, transporterId, reason } });
    await tx.tanker.updateMany({ where: { assignedDriverId: d.id }, data: { assignedDriverId: null } });
    await tx.driver.update({ where: { id: d.id }, data: { agencyId: transporterId, verificationStatus: 'PENDING_VERIFICATION' } });
    await tx.agencyMember.updateMany({ where: { userId: d.userId }, data: { agencyId: transporterId } });
    await audit({ action: 'driver.transferred', entityType: 'driver', entityId: d.id, module: 'drivers', previousValue: { transporterId: d.agencyId }, newValue: { transporterId, reason }, req }, tx);
  });
  ok(res, `Driver moved to ${t.companyName}; re-verification required`, null);
});

// ===========================================================================
// Tankers
// ===========================================================================

export const adminTankersRouter = Router();
adminTankersRouter.use(...adminAuth);

const tankerColumns: Column[] = [
  { key: 'registrationNumber', label: 'Vehicle number', format: 'text' },
  { key: 'transporter', label: 'Transporter', format: 'text' },
  { key: 'tankerType', label: 'Tanker type', format: 'text' },
  { key: 'capacityKl', label: 'Capacity (KL)', format: 'number' },
  { key: 'compartments', label: 'Compartments', format: 'number' },
  { key: 'products', label: 'Product compatibility', format: 'text' },
  { key: 'status', label: 'Availability', format: 'text' },
  { key: 'driver', label: 'Assigned driver', format: 'text' },
  { key: 'insuranceExpiry', label: 'Insurance expiry', format: 'date' },
  { key: 'fitnessExpiry', label: 'Fitness expiry', format: 'date' },
  { key: 'permitExpiry', label: 'Permit expiry', format: 'date' },
  { key: 'pesoLicenceNumber', label: 'PESO licence', format: 'text' },
  { key: 'gpsDeviceId', label: 'GPS device', format: 'text' },
  { key: 'verificationStatus', label: 'Verification', format: 'text' },
];

const ACTIVE_TRIP_STATUSES = ['VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'REACHED_PICKUP', 'LOADING', 'LOADING_COMPLETED', 'IN_TRANSIT', 'REACHED_DESTINATION', 'UNLOADING_STARTED', 'UNLOADING_COMPLETED'] as const;

adminTankersRouter.get('/', can('tankers', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { transporterId: z.string().uuid().optional(), status: z.string().optional(), verification: z.string().optional(), capacity: z.coerce.number().optional(), expiring: z.enum(['true']).optional() });
  const scope = await transporterScope(req);
  const soon = new Date(Date.now() + 30 * 86400_000);
  const where: Prisma.TankerWhereInput = {
    ...(scope ? { transporterId: { in: scope } } : {}),
    ...(q.transporterId ? { transporterId: q.transporterId as string } : {}),
    ...(q.status ? { status: q.status as TankerStatus } : {}),
    ...(q.verification ? { verificationStatus: q.verification as never } : {}),
    ...(q.capacity ? { capacityKl: q.capacity as number } : {}),
    ...(q.expiring ? { OR: [{ insuranceExpiry: { lte: soon } }, { fitnessExpiry: { lte: soon } }, { permitExpiry: { lte: soon } }, { pucExpiry: { lte: soon } }, { pesoExpiry: { lte: soon } }] } : {}),
    ...(q.q ? { AND: [{ OR: [{ registrationNumber: insensitive(q.q) }, { gpsDeviceId: insensitive(q.q) }, { transporter: { companyName: insensitive(q.q) } }] }] } : {}),
  };
  const load = async (paged: boolean) => {
    const rows = await prisma.tanker.findMany({
      where,
      orderBy: orderBy(q, ['createdAt', 'registrationNumber', 'capacityKl', 'status'], 'createdAt'),
      ...win(q, paged),
      include: { transporter: { select: { id: true, companyName: true } }, tankerType: { select: { name: true } }, products: { select: { product: { select: { name: true } } } }, assignedDriver: { select: { user: { select: { fullName: true } } } } },
    });
    return rows.map((t) => ({
      id: t.id,
      registrationNumber: t.registrationNumber,
      transporter: t.transporter.companyName,
      transporterId: t.transporter.id,
      tankerType: t.tankerType.name,
      capacityKl: t.capacityKl,
      compartments: t.compartments,
      products: t.products.map((p) => p.product.name).join(', '),
      status: t.status,
      driver: t.assignedDriver?.user.fullName ?? null,
      insuranceExpiry: t.insuranceExpiry,
      fitnessExpiry: t.fitnessExpiry,
      permitExpiry: t.permitExpiry,
      pucExpiry: t.pucExpiry,
      pesoLicenceNumber: t.pesoLicenceNumber,
      pesoExpiry: t.pesoExpiry,
      gpsDeviceId: t.gpsDeviceId,
      verificationStatus: t.verificationStatus,
      lastLocationAt: t.lastLocationAt,
      isDemo: t.isDemo,
    }));
  };
  const [total, rows] = await Promise.all([prisma.tanker.count({ where }), load(true)]);
  await respondList(req, res, { title: 'Tankers', q, columns: tankerColumns, total, rows, exportRows: () => load(false), module: 'tankers' });
});

const tankerSchema = z.object({
  transporterId: z.string().uuid(),
  registrationNumber: z.string().trim().toUpperCase().transform((v) => v.replace(/[\s-]/g, '')).pipe(z.string().regex(/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/, 'Enter a valid registration number, e.g. MH12AB1234')),
  capacityKl: z.number().positive().max(60),
  tankerTypeId: z.string().uuid(),
  compartments: z.number().int().min(1).max(8).default(1),
  productIds: z.array(z.string().uuid()).min(1, 'Select at least one compatible product'),
  gpsDeviceId: z.string().trim().max(60).optional().or(z.literal('').transform(() => undefined)),
  insuranceExpiry: optDate,
  fitnessExpiry: optDate,
  permitExpiry: optDate,
  pucExpiry: optDate,
  pesoLicenceNumber: z.string().trim().max(40).optional().or(z.literal('').transform(() => undefined)),
  pesoExpiry: optDate,
});

adminTankersRouter.post('/', can('tankers', 'create'), async (req: Request, res: Response) => {
  const input = body(req, tankerSchema);
  if (!(await prisma.agency.findUnique({ where: { id: input.transporterId } }))) throw AppError.badRequest('Transporter not found');
  if (await prisma.tanker.findUnique({ where: { registrationNumber: input.registrationNumber } })) throw AppError.conflict('A tanker with this registration number already exists');
  const { productIds, ...data } = input;
  const t = await prisma.$transaction(async (tx) => {
    const t = await tx.tanker.create({ data: { ...data, products: { create: productIds.map((productId) => ({ productId })) } } });
    await audit({ action: 'tanker.created_by_admin', entityType: 'tanker', entityId: t.id, module: 'tankers', newValue: { registrationNumber: t.registrationNumber }, req }, tx);
    return t;
  });
  created(res, 'Tanker added (pending verification)', { tanker: t });
});

async function tankerOr404(req: Request) {
  const id = idOf(req);
  const t = await prisma.tanker.findUnique({ where: { id }, include: { products: { include: { product: true } }, tankerType: true, transporter: { select: { id: true, companyName: true } }, assignedDriver: { include: { user: { select: { fullName: true, phone: true } } } } } });
  if (!t) throw AppError.notFound('Tanker not found');
  const scope = await transporterScope(req);
  if (scope && !scope.includes(t.transporterId)) throw AppError.notFound('Tanker not found');
  return t;
}

adminTankersRouter.get('/:id', can('tankers', 'view'), async (req: Request, res: Response) => {
  const t = await tankerOr404(req);
  const [trips, documents, reviews, rules] = await Promise.all([
    prisma.trip.findMany({ where: { tankerId: t.id }, orderBy: { createdAt: 'desc' }, take: 100, include: { booking: { select: { id: true, bookingCode: true } }, driver: { select: { user: { select: { fullName: true } } } } } }),
    prisma.kycDocument.findMany({ where: { ownerType: 'TANKER', ownerId: t.id }, orderBy: { createdAt: 'desc' } }),
    reviewHistory('TANKER', t.id),
    prisma.complianceRule.findMany({ where: { ownerType: 'TANKER', isActive: true, OR: [{ productId: null }, { productId: { in: t.products.map((p) => p.productId) } }] } }),
  ]);
  // Compliance: which mandatory documents are present & verified for the products this tanker carries.
  const current = documents.filter((d) => d.isCurrent);
  const compliance = [...new Map(rules.filter((r) => r.isMandatory).map((r) => [r.docType, r])).values()].map((r) => {
    const doc = current.find((d) => d.docType === r.docType);
    return { docType: r.docType, description: r.description, status: !doc ? 'MISSING' : doc.status === 'VERIFIED' ? (doc.expiryDate && doc.expiryDate.getTime() < Date.now() ? 'EXPIRED' : 'OK') : doc.status };
  });
  ok(res, 'Tanker', { tanker: t, trips, documents, verificationHistory: reviews, compliance });
});

adminTankersRouter.put('/:id', can('tankers', 'edit'), async (req: Request, res: Response) => {
  const t = await tankerOr404(req);
  const input = body(req, tankerSchema.omit({ transporterId: true, registrationNumber: true }).partial().strict());
  const { productIds, ...data } = input;
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.tanker.update({ where: { id: t.id }, data });
    if (productIds) {
      await tx.tankerProduct.deleteMany({ where: { tankerId: t.id } });
      await tx.tankerProduct.createMany({ data: productIds.map((productId) => ({ tankerId: t.id, productId })) });
    }
    await audit({
      action: 'tanker.updated_by_admin',
      entityType: 'tanker',
      entityId: t.id,
      module: 'tankers',
      previousValue: { insuranceExpiry: t.insuranceExpiry, fitnessExpiry: t.fitnessExpiry, permitExpiry: t.permitExpiry, products: t.products.map((p) => p.product.code) },
      newValue: input as Prisma.InputJsonValue,
      req,
    }, tx);
    return u;
  });
  ok(res, 'Tanker updated', { tanker: updated });
});

adminTankersRouter.post('/:id/review', async (req: Request, res: Response) => {
  const { action, reason } = body(req, reviewSchema);
  await needPerm(req, res, 'tankers', action === 'REJECT' ? 'reject' : action === 'APPROVE' ? 'approve' : 'edit');
  const t = await tankerOr404(req);
  if (action === 'REJECT' && (!reason || reason.length < 5)) throw AppError.badRequest('A rejection reason is required', ErrorCode.VALIDATION_ERROR, [{ field: 'reason', message: 'Explain why' }]);
  if (action === 'APPROVE') {
    const expired = (['insuranceExpiry', 'fitnessExpiry', 'permitExpiry'] as const).filter((k) => t[k] && t[k]!.getTime() < Date.now());
    if (expired.length) throw AppError.conflict(`Cannot approve: ${expired.join(', ')} has expired`);
  }
  const to = action === 'START_REVIEW' ? 'UNDER_REVIEW' : action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  await prisma.$transaction(async (tx) => {
    await tx.tanker.update({ where: { id: t.id }, data: { verificationStatus: to, rejectionReason: to === 'REJECTED' ? reason : null } });
    await recordReview(tx, { entityType: 'TANKER', entityId: t.id, fromStatus: t.verificationStatus, toStatus: to, reason, reviewerId: req.admin!.userId });
    await audit({ action: `tanker.${to.toLowerCase()}`, entityType: 'tanker', entityId: t.id, module: 'tankers', previousValue: { status: t.verificationStatus }, newValue: { status: to, reason: reason ?? null }, req }, tx);
  });
  ok(res, `Tanker ${to.toLowerCase().replace('_', ' ')}`, { status: to });
});

/** Availability changes (mark unavailable / maintenance / available / suspended). Blocked while on a trip. */
adminTankersRouter.post('/:id/status', can('tankers', 'edit'), async (req: Request, res: Response) => {
  const t = await tankerOr404(req);
  const { status, reason } = body(req, z.object({ status: z.enum(['AVAILABLE', 'MAINTENANCE', 'UNAVAILABLE', 'SUSPENDED']), reason: z.string().trim().min(3).max(300) }));
  const onTrip = await prisma.trip.count({ where: { tankerId: t.id, status: { in: [...ACTIVE_TRIP_STATUSES] } } });
  if (onTrip && status !== 'AVAILABLE') throw AppError.conflict('Tanker is on an active trip; change status after the trip completes', ErrorCode.INVALID_STATE_TRANSITION);
  if (onTrip && status === 'AVAILABLE') throw AppError.conflict('Tanker is on an active trip', ErrorCode.INVALID_STATE_TRANSITION);
  await prisma.$transaction(async (tx) => {
    await tx.tanker.update({ where: { id: t.id }, data: { status } });
    await audit({ action: 'tanker.status_changed', entityType: 'tanker', entityId: t.id, module: 'tankers', previousValue: { status: t.status }, newValue: { status, reason }, req }, tx);
  });
  ok(res, `Tanker marked ${status.toLowerCase()}`, { status });
});

/** Driver assignment: same transporter, verified, active, and not already driving another tanker. */
adminTankersRouter.post('/:id/assign-driver', can('tankers', 'edit'), async (req: Request, res: Response) => {
  const t = await tankerOr404(req);
  const { driverId } = body(req, z.object({ driverId: z.string().uuid().nullable() }));
  if (driverId) {
    const d = await prisma.driver.findUnique({ where: { id: driverId }, include: { user: { select: { accountStatus: true } }, assignedTanker: { select: { registrationNumber: true } } } });
    if (!d || d.agencyId !== t.transporterId) throw AppError.badRequest('Driver must belong to the same transporter');
    if (d.verificationStatus !== 'APPROVED') throw AppError.badRequest('Only verified drivers can be assigned');
    if (d.user.accountStatus !== 'ACTIVE') throw AppError.badRequest('Driver account is not active');
    if (d.assignedTanker && d.assignedTanker.registrationNumber !== t.registrationNumber) throw AppError.conflict(`Driver is already assigned to ${d.assignedTanker.registrationNumber}`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.tanker.update({ where: { id: t.id }, data: { assignedDriverId: driverId } });
    await audit({ action: 'tanker.driver_assigned', entityType: 'tanker', entityId: t.id, module: 'tankers', previousValue: { driverId: t.assignedDriverId }, newValue: { driverId }, req }, tx);
  });
  ok(res, driverId ? 'Driver assigned' : 'Driver unassigned', null);
});
