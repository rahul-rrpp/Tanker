import type { Prisma } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { authenticateUser } from '../../middleware/auth';
import { requireTransporter } from '../../middleware/transporter';
import { multipart, sendStoredFile } from '../../middleware/upload';
import { validateRequest } from '../../middleware/validate';
import { AppError, ErrorCode } from '../../utils/errors';
import { created, ok } from '../../utils/response';
import { phoneSchema } from '../../utils/validators';
import { audit } from '../audit/audit';
import { sendLoginOtp } from '../auth/auth.service';
import { revokeAllUserSessions } from '../auth/token.service';
import { LICENCE_TYPES } from '../auth/auth.schemas';
import { idParam, listKyc, ownedDriver, pageOf, parsePaging, saveKycDocument, tid, uid } from './common';

/** Drivers are sub-users: a controlled relationship to one transporter, with their own login and no shared password. */
export const transporterDriversRouter = Router();

const view = [authenticateUser, requireTransporter({ permission: 'agency:drivers:read' })];
const manage = [authenticateUser, requireTransporter({ permission: 'agency:drivers:manage' })];

export const DRIVER_DOC_TYPES = ['DRIVING_LICENCE', 'IDENTITY_PROOF', 'ADDRESS_PROOF', 'HAZMAT_TRAINING', 'OTHER'] as const;

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').transform((s) => new Date(`${s}T00:00:00Z`));
const optEmail = z.string().trim().toLowerCase().email().max(254).optional().or(z.literal('').transform(() => undefined));

const driverFields = {
  address: z.string().trim().min(5).max(300),
  licenceType: z.enum(LICENCE_TYPES),
  licenceExpiry: dateOnly,
  hazardousTraining: z.enum(['NOT_PROVIDED', 'PENDING', 'VALID', 'EXPIRED', 'NOT_REQUIRED']),
  hazardousTrainingExpiry: dateOnly.optional(),
  emergencyContactName: z.string().trim().min(2).max(120),
  emergencyContactPhone: phoneSchema,
  employmentStatus: z.enum(['ACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED']),
};

const createSchema = z
  .object({ fullName: z.string().trim().min(2).max(120), phone: phoneSchema, email: optEmail, licenceNumber: z.string().trim().toUpperCase().min(6).max(20), ...driverFields })
  .strict();
const updateSchema = z.object({ fullName: z.string().trim().min(2).max(120), email: optEmail, ...driverFields }).partial().strict();

const include = {
  user: { select: { id: true, fullName: true, phone: true, email: true, accountStatus: true, isPhoneVerified: true, lastLoginAt: true } },
  assignedTanker: { select: { id: true, registrationNumber: true } },
  _count: { select: { trips: true } },
} satisfies Prisma.DriverInclude;

const shape = (d: Prisma.DriverGetPayload<{ include: typeof include }>) => ({
  id: d.id, fullName: d.user.fullName, phone: d.user.phone, email: d.user.email, accountStatus: d.user.accountStatus, isPhoneVerified: d.user.isPhoneVerified, lastLoginAt: d.user.lastLoginAt,
  licenceNumber: d.licenceNumber, licenceType: d.licenceType, licenceExpiry: d.licenceExpiry, hazardousTraining: d.hazardousTraining, hazardousTrainingExpiry: d.hazardousTrainingExpiry, address: d.address,
  emergencyContactName: d.emergencyContactName, emergencyContactPhone: d.emergencyContactPhone, employmentStatus: d.employmentStatus, isActive: d.isActive, invitedAt: d.invitedAt, verificationStatus: d.verificationStatus, rejectionReason: d.rejectionReason, isDemo: d.isDemo,
  assignedTanker: d.assignedTanker, tripCount: d._count.trips,
});

transporterDriversRouter.post('/me/drivers', ...manage, validateRequest({ body: createSchema }), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof createSchema>;
  const clash = await prisma.user.findFirst({ where: { OR: [{ phone: b.phone }, ...(b.email ? [{ email: b.email }] : [])] }, select: { id: true, phone: true } });
  if (clash) throw AppError.conflict(clash.phone === b.phone ? 'This mobile number is already registered' : 'This email is already registered', clash.phone === b.phone ? ErrorCode.PHONE_ALREADY_REGISTERED : ErrorCode.EMAIL_ALREADY_REGISTERED);
  if (await prisma.driver.count({ where: { licenceNumber: b.licenceNumber } })) throw AppError.conflict('This licence number is already registered');
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'DRIVER' }, select: { id: true } });
  const { fullName, phone, email, ...driver } = b;
  const row = await prisma.$transaction(async (tx) => {
    // No password: the driver signs in with an OTP to their own mobile. The login stays pending until then.
    const user = await tx.user.create({ data: { fullName, phone, email, accountStatus: 'PENDING_VERIFICATION', roles: { create: { roleId: role.id } } } });
    const d = await tx.driver.create({ data: { ...driver, userId: user.id, agencyId: tid(req), verificationStatus: 'PENDING_VERIFICATION', history: { create: { transporterId: tid(req), reason: 'Added by transporter' } } }, include });
    await tx.agencyMember.create({ data: { agencyId: tid(req), userId: user.id, role: 'DRIVER' } });
    await audit({ action: 'driver.created', entityType: 'driver', entityId: d.id, actorType: 'TRANSPORTER', actorUserId: uid(req), metadata: { phoneLast4: phone.slice(-4) }, req }, tx);
    return d;
  });
  created(res, 'Driver added. Upload documents, then send the login invitation.', { driver: shape(row) });
});

transporterDriversRouter.get('/me/drivers', ...view, async (req: Request, res: Response) => {
  const q = parsePaging(req);
  const s = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const where: Prisma.DriverWhereInput = { agencyId: tid(req), ...(s ? { user: { OR: [{ fullName: { contains: s, mode: 'insensitive' } }, { phone: { contains: s } }] } } : {}) };
  const [total, rows] = await Promise.all([prisma.driver.count({ where }), prisma.driver.findMany({ where, include, orderBy: { createdAt: 'desc' }, ...pageOf(q) })]);
  ok(res, 'Drivers', { total, page: q.page, pageSize: q.pageSize, items: rows.map(shape) });
});

transporterDriversRouter.get('/me/drivers/:id', ...view, idParam, async (req: Request, res: Response) => {
  await ownedDriver(tid(req), String(req.params.id));
  const id = String(req.params.id);
  const [d, documents, trips, history] = await Promise.all([
    prisma.driver.findUniqueOrThrow({ where: { id }, include }),
    listKyc('DRIVER', id),
    prisma.trip.findMany({ where: { driverId: id, transporterId: tid(req) }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, tripCode: true, status: true, createdAt: true, completedAt: true, deliveredAt: true, plannedEndAt: true, tanker: { select: { registrationNumber: true } }, booking: { select: { bookingCode: true, locations: { select: { type: true, city: true } } } } } }),
    prisma.driverTransporterHistory.findMany({ where: { driverId: id, transporterId: tid(req) }, orderBy: { fromDate: 'desc' } }),
  ]);
  const done = trips.filter((t) => t.status === 'COMPLETED' || t.status === 'DELIVERED');
  const onTime = done.filter((t) => t.deliveredAt && t.plannedEndAt && t.deliveredAt <= t.plannedEndAt).length;
  const timed = done.filter((t) => t.deliveredAt && t.plannedEndAt).length;
  ok(res, 'Driver', { driver: shape(d), documents, trips, history, performance: { assigned: trips.length, completed: done.length, cancelled: trips.filter((t) => t.status === 'CANCELLED').length, onTimePercent: timed ? Math.round((onTime / timed) * 100) : null } });
});

transporterDriversRouter.put('/me/drivers/:id', ...manage, idParam, validateRequest({ body: updateSchema }), async (req: Request, res: Response) => {
  const d = await ownedDriver(tid(req), String(req.params.id));
  const { fullName, email, ...driver } = req.body as z.infer<typeof updateSchema>;
  // Replacing qualifications on a verified driver sends the record back for review.
  const reVerify = Boolean(driver.licenceExpiry || driver.licenceType) && d.verificationStatus === 'APPROVED';
  await prisma.$transaction(async (tx) => {
    if (fullName || email !== undefined) await tx.user.update({ where: { id: d.userId }, data: { ...(fullName ? { fullName } : {}), ...(email !== undefined ? { email } : {}) } });
    await tx.driver.update({ where: { id: d.id }, data: { ...driver, ...(reVerify ? { verificationStatus: 'UNDER_REVIEW' as const } : {}) } });
    await audit({ action: 'driver.updated', entityType: 'driver', entityId: d.id, actorType: 'TRANSPORTER', actorUserId: uid(req), metadata: { reVerify }, req }, tx);
  });
  ok(res, reVerify ? 'Saved. Updated qualifications need re-verification.' : 'Driver saved', { driver: shape(await prisma.driver.findUniqueOrThrow({ where: { id: d.id }, include })) });
});

transporterDriversRouter.post('/me/drivers/:id/documents', ...manage, idParam, multipart({ field: 'file' }), async (req: Request, res: Response) => {
  await ownedDriver(tid(req), String(req.params.id));
  const doc = await saveKycDocument(req, { type: 'DRIVER', id: String(req.params.id), transporterId: tid(req) }, DRIVER_DOC_TYPES);
  created(res, 'Document uploaded', { document: { id: doc.id, docType: doc.docType, status: doc.status } });
});

transporterDriversRouter.get('/me/drivers/:id/documents/:docId/download', ...view, validateRequest({ params: z.object({ id: z.string().uuid(), docId: z.string().uuid() }) }), async (req: Request, res: Response) => {
  await ownedDriver(tid(req), String(req.params.id));
  const d = await prisma.kycDocument.findFirst({ where: { id: String(req.params.docId), ownerType: 'DRIVER', ownerId: String(req.params.id) } });
  if (!d) throw AppError.notFound('Document not found');
  sendStoredFile(res, d, req.query.inline === '1');
});

transporterDriversRouter.post('/me/drivers/:id/invite', ...manage, idParam, async (req: Request, res: Response) => {
  const d = await ownedDriver(tid(req), String(req.params.id));
  if (!d.isActive || d.user.accountStatus === 'SUSPENDED' || d.user.accountStatus === 'DEACTIVATED') throw AppError.conflict('Activate this driver before sending an invitation', ErrorCode.INVALID_STATE_TRANSITION);
  const r = await sendLoginOtp(d.user.phone, req.ip ?? null);
  await prisma.driver.update({ where: { id: d.id }, data: { invitedAt: new Date() } });
  await audit({ action: 'driver.invited', entityType: 'driver', entityId: d.id, actorType: 'TRANSPORTER', actorUserId: uid(req), req });
  ok(res, 'Login code sent to the driver’s mobile', { invitedAt: new Date(), signInPath: '/login', ...('devCode' in r && r.devCode && !env.isProduction ? { devCode: r.devCode } : {}) });
});

const STATUS: Record<string, { accountStatus: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'; isActive: boolean; revoke: boolean }> = {
  ACTIVATE: { accountStatus: 'ACTIVE', isActive: true, revoke: false },
  SUSPEND: { accountStatus: 'SUSPENDED', isActive: true, revoke: true },
  DEACTIVATE: { accountStatus: 'DEACTIVATED', isActive: false, revoke: true },
};

transporterDriversRouter.put('/me/drivers/:id/status', ...manage, idParam, validateRequest({ body: z.object({ action: z.enum(['ACTIVATE', 'SUSPEND', 'DEACTIVATE', 'RESET_ACCESS']), reason: z.string().trim().max(300).optional() }).strict() }), async (req: Request, res: Response) => {
  const d = await ownedDriver(tid(req), String(req.params.id));
  const action = req.body.action as string;
  if (action !== 'RESET_ACCESS' && action !== 'ACTIVATE') {
    const live = await prisma.trip.count({ where: { driverId: d.id, status: { in: ['DRIVER_ACCEPTED', 'REACHED_PICKUP', 'LOADING', 'LOADING_COMPLETED', 'IN_TRANSIT', 'REACHED_DESTINATION', 'UNLOADING_STARTED', 'UNLOADING_COMPLETED'] } } });
    if (live) throw AppError.conflict('This driver is on an active trip. Reassign the trip first.', ErrorCode.RESOURCE_CONFLICT);
  }
  if (action === 'RESET_ACCESS') {
    await prisma.user.update({ where: { id: d.userId }, data: { passwordHash: null, failedLoginAttempts: 0, lockedUntil: null } });
    await revokeAllUserSessions(d.userId, 'ADMIN_RESET');
  } else {
    const s = STATUS[action];
    await prisma.$transaction(async (tx) => {
      // Activating an account that has never signed in keeps it pending until the OTP proves the phone.
      const accountStatus = action === 'ACTIVATE' && !d.user.isPhoneVerified ? 'PENDING_VERIFICATION' : s.accountStatus;
      await tx.user.update({ where: { id: d.userId }, data: { accountStatus } });
      await tx.driver.update({ where: { id: d.id }, data: { isActive: s.isActive } });
    });
    if (s.revoke) await revokeAllUserSessions(d.userId, 'ADMIN_RESET');
  }
  await audit({ action: `driver.${action.toLowerCase()}`, entityType: 'driver', entityId: d.id, actorType: 'TRANSPORTER', actorUserId: uid(req), metadata: { reason: req.body.reason ?? null }, req });
  ok(res, 'Driver access updated', null);
});
