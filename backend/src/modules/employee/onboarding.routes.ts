import type { Prisma } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { storage } from '../../lib/storage';
import { multipart, storeUpload } from '../../middleware/upload';
import { AppError, ErrorCode } from '../../utils/errors';
import { created, ok } from '../../utils/response';
import { phoneSchema } from '../../utils/validators';
import { assertInScope, assignedIds, body, can, hasPermission, idOf, insensitive, parseList, win } from '../admin/core';
import { assignEntity, companyCreateSchema, createCompanyOnBehalf, createTransporterOnBehalf, reviewHistory, transporterCreateSchema } from '../admin/parties.routes';
import { audit } from '../audit/audit';
import { LICENCE_TYPES } from '../auth/auth.schemas';
import { member, uid } from './common';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((s) => new Date(`${s}T00:00:00Z`));

export const driverSchema = z.object({
  transporterId: z.string().uuid('Select the transporter'),
  fullName: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  address: z.string().trim().min(5).max(300),
  licenceNumber: z.string().trim().toUpperCase().min(6).max(20),
  licenceType: z.enum(LICENCE_TYPES).default('HGMV'),
  licenceExpiry: dateOnly,
  hazardousTraining: z.enum(['NOT_PROVIDED', 'PENDING', 'VALID', 'EXPIRED', 'NOT_REQUIRED']).default('NOT_PROVIDED'),
  hazardousTrainingExpiry: dateOnly.optional(),
  emergencyContactName: z.string().trim().min(2).max(120),
  emergencyContactPhone: phoneSchema,
  leadId: z.string().uuid().optional(),
});

/** Drivers are always sub-users of a transporter; there is no independent driver account. */
export async function registerDriver(req: Request, input: z.infer<typeof driverSchema>) {
  await assertInScope(req, 'TRANSPORTER', input.transporterId);
  if (!(await prisma.agency.findUnique({ where: { id: input.transporterId }, select: { id: true } }))) throw AppError.badRequest('Select the transporter this driver works for');
  if (await prisma.user.findUnique({ where: { phone: input.phone } })) throw AppError.conflict('This mobile number is already registered', ErrorCode.PHONE_ALREADY_REGISTERED);
  if (await prisma.driver.findUnique({ where: { licenceNumber: input.licenceNumber } })) throw AppError.conflict('This driving licence is already registered');
  const roleId = (await prisma.role.findUniqueOrThrow({ where: { name: 'DRIVER' } })).id;
  const { transporterId, fullName, phone, leadId: _leadId, ...fields } = input;
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { fullName, phone, accountStatus: 'PENDING_VERIFICATION', roles: { create: { roleId } } } });
    const d = await tx.driver.create({ data: { ...fields, userId: user.id, agencyId: transporterId, history: { create: { transporterId, reason: 'Registered by employee' } } } });
    await tx.agencyMember.create({ data: { agencyId: transporterId, userId: user.id, role: 'DRIVER' } });
    await audit({ action: 'driver.created_by_employee', entityType: 'driver', entityId: d.id, module: 'drivers', actorType: 'EMPLOYEE', newValue: { name: fullName, transporterId }, req }, tx);
    return d;
  });
}

/** Who registered this account, from which lead. Never overwritten; manager changes are kept in assignment history. */
async function attribution(entityType: 'COMPANY' | 'TRANSPORTER', entityId: string, createdById: string | null, createdAt: Date) {
  const [employee, lead, assignments] = await Promise.all([
    createdById ? prisma.employee.findUnique({ where: { userId: createdById }, select: { employeeCode: true, branch: true, territory: true, user: { select: { fullName: true } } } }) : null,
    prisma.lead.findFirst({ where: { convertedEntityType: entityType, convertedEntityId: entityId }, select: { id: true, leadCode: true, source: true } }),
    prisma.employeeAssignment.findMany({ where: { entityType, entityId }, orderBy: { assignedAt: 'desc' }, include: { employee: { select: { employeeCode: true, user: { select: { fullName: true } } } } } }),
  ]);
  return { employeeCode: employee?.employeeCode ?? null, employeeName: employee?.user.fullName ?? null, registrationDate: createdAt, leadId: lead?.id ?? null, leadCode: lead?.leadCode ?? null, leadSource: lead?.source ?? null, branch: employee?.branch ?? null, territory: employee?.territory ?? null, accountManagers: assignments.map((a) => ({ name: a.employee.user.fullName, code: a.employee.employeeCode, from: a.assignedAt, to: a.endedAt })) };
}

export const onboardingRouter = Router();
onboardingRouter.use(...member);

// ---- Companies ----------------------------------------------------------------------------------

onboardingRouter.post('/companies', can('companies', 'create'), async (req: Request, res: Response) => {
  const company = await createCompanyOnBehalf(req, body(req, companyCreateSchema));
  created(res, `Company ${company.companyCode} registered`, { company });
});

onboardingRouter.get('/companies', can('companies', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { status: z.string().optional() });
  const ids = await assignedIds(req, 'COMPANY');
  const where: Prisma.CompanyWhereInput = { ...(ids ? { id: { in: ids } } : {}), ...(q.status ? { status: q.status as never } : {}), ...(q.q ? { OR: [{ name: insensitive(q.q) }, { companyCode: insensitive(q.q) }, { contactPhone: { contains: q.q } }] } : {}) };
  const [total, items] = await Promise.all([prisma.company.count({ where }), prisma.company.findMany({ where, orderBy: { createdAt: 'desc' }, ...win(q, true), select: { id: true, companyCode: true, name: true, contactPersonName: true, contactPhone: true, status: true, businessType: true, createdAt: true } })]);
  ok(res, 'Companies', { total, page: q.page, pageSize: q.pageSize, items });
});

onboardingRouter.get('/companies/:id', can('companies', 'view'), async (req: Request, res: Response) => {
  const id = idOf(req);
  await assertInScope(req, 'COMPANY', id);
  const c = await prisma.company.findUnique({ where: { id }, include: { addresses: true, documents: { where: { isCurrent: true }, select: { id: true, type: true, fileName: true, status: true, reviewNote: true, createdAt: true } } } });
  if (!c) throw AppError.notFound('Company not found');
  const [bookings, reviews, attr] = await Promise.all([
    hasPermission(req, 'bookings', 'view') ? prisma.booking.findMany({ where: { companyId: id }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, bookingCode: true, status: true, createdAt: true, customerOffer: true } }) : [],
    reviewHistory('COMPANY', id),
    attribution('COMPANY', id, c.createdById, c.createdAt),
  ]);
  ok(res, 'Company', { company: c, bookings, verificationHistory: reviews, attribution: attr });
});

onboardingRouter.post('/companies/:id/documents', can('companies', 'create'), multipart({ field: 'file' }), async (req: Request, res: Response) => {
  const id = idOf(req);
  await assertInScope(req, 'COMPANY', id);
  const { type } = z.object({ type: z.enum(['GST_CERTIFICATE', 'PAN_CARD', 'REGISTRATION_CERTIFICATE', 'OTHER']) }).strict().parse(req.body ?? {});
  if (!(await prisma.company.count({ where: { id } }))) throw AppError.notFound('Company not found');
  const file = await storeUpload(req.file, 'company-documents', ['pdf', 'png', 'jpeg']);
  try {
    const doc = await prisma.$transaction(async (tx) => {
      if (type !== 'OTHER') await tx.companyDocument.updateMany({ where: { companyId: id, type, isCurrent: true }, data: { isCurrent: false } });
      const d = await tx.companyDocument.create({ data: { companyId: id, type, uploadedById: uid(req), ...file } });
      await audit({ action: 'company.document_uploaded', entityType: 'company', entityId: id, companyId: id, module: 'companies', actorType: 'EMPLOYEE', metadata: { type }, req }, tx);
      return d;
    });
    created(res, 'Document uploaded', { document: { id: doc.id, status: doc.status } });
  } catch (e) {
    await storage.remove(file.storageKey);
    throw e;
  }
});

onboardingRouter.post('/companies/:id/account-manager', can('companies', 'assign'), async (req: Request, res: Response) => {
  const id = idOf(req);
  await assertInScope(req, 'COMPANY', id);
  const { employeeId } = body(req, z.object({ employeeId: z.string().uuid() }).strict());
  await assignEntity(req, 'COMPANY', id, employeeId);
  ok(res, 'Account manager assigned', null);
});

// ---- Transporters -------------------------------------------------------------------------------

const transporterOnboard = transporterCreateSchema.extend({ operatingCities: z.array(z.string().trim().max(80)).max(100).default([]), preferredRoutes: z.array(z.string().trim().max(120)).max(100).default([]), declaredTankers: z.number().int().min(0).max(100000).optional(), capacityCategories: z.array(z.string().trim().max(20)).max(30).default([]), productCategories: z.array(z.string().trim().max(40)).max(50).default([]) });

onboardingRouter.post('/transporters', can('transporters', 'create'), async (req: Request, res: Response) => {
  const { operatingCities, preferredRoutes, declaredTankers, capacityCategories, productCategories, ...core } = body(req, transporterOnboard);
  const t = await createTransporterOnBehalf(req, core);
  const transporter = await prisma.agency.update({ where: { id: t.id }, data: { operatingCities, preferredRoutes, declaredTankers, capacityCategories, productCategories } });
  created(res, `Transporter ${transporter.transporterCode} registered`, { transporter: { id: transporter.id, transporterCode: transporter.transporterCode, verificationStatus: transporter.verificationStatus } });
});

onboardingRouter.get('/transporters', can('transporters', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { status: z.string().optional() });
  const ids = await assignedIds(req, 'TRANSPORTER');
  const where: Prisma.AgencyWhereInput = { ...(ids ? { id: { in: ids } } : {}), ...(q.status ? { verificationStatus: q.status as never } : {}), ...(q.q ? { OR: [{ companyName: insensitive(q.q) }, { transporterCode: insensitive(q.q) }] } : {}) };
  const [total, items] = await Promise.all([prisma.agency.count({ where }), prisma.agency.findMany({ where, orderBy: { createdAt: 'desc' }, ...win(q, true), select: { id: true, transporterCode: true, companyName: true, city: true, state: true, verificationStatus: true, createdAt: true, owner: { select: { fullName: true, phone: true } }, _count: { select: { tankers: true, drivers: true } } } })]);
  ok(res, 'Transporters', { total, page: q.page, pageSize: q.pageSize, items });
});

onboardingRouter.get('/transporters/:id', can('transporters', 'view'), async (req: Request, res: Response) => {
  const id = idOf(req);
  await assertInScope(req, 'TRANSPORTER', id);
  const t = await prisma.agency.findUnique({ where: { id }, select: { id: true, transporterCode: true, companyName: true, gstNumber: true, panNumber: true, address: true, city: true, state: true, pincode: true, verificationStatus: true, rejectionReason: true, operatingCities: true, preferredRoutes: true, declaredTankers: true, createdAt: true, createdById: true, owner: { select: { fullName: true, phone: true, email: true } } } });
  if (!t) throw AppError.notFound('Transporter not found');
  const [documents, tankers, drivers, reviews, attr] = await Promise.all([
    prisma.kycDocument.findMany({ where: { ownerType: 'TRANSPORTER', ownerId: id, isCurrent: true }, select: { id: true, docType: true, fileName: true, status: true, reviewNote: true } }),
    prisma.tanker.findMany({ where: { transporterId: id }, select: { id: true, registrationNumber: true, capacityKl: true, verificationStatus: true } }),
    prisma.driver.findMany({ where: { agencyId: id }, select: { id: true, licenceNumber: true, verificationStatus: true, user: { select: { fullName: true } } } }),
    reviewHistory('TRANSPORTER', id),
    attribution('TRANSPORTER', id, t.createdById, t.createdAt),
  ]);
  ok(res, 'Transporter', { transporter: t, documents, tankers, drivers, verificationHistory: reviews, attribution: attr });
});

async function kycUpload(req: Request, res: Response, ownerType: 'TRANSPORTER' | 'DRIVER' | 'TANKER', ownerId: string, allowed: readonly string[]) {
  const input = z.object({ docType: z.string().refine((d) => allowed.includes(d), 'Choose a document type'), expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').transform(() => undefined)) }).strict().parse(req.body ?? {});
  const file = await storeUpload(req.file, 'kyc-documents', ['pdf', 'png', 'jpeg']);
  try {
    const doc = await prisma.$transaction(async (tx) => {
      if (input.docType !== 'OTHER') await tx.kycDocument.updateMany({ where: { ownerType, ownerId, docType: input.docType, isCurrent: true }, data: { isCurrent: false } });
      const d = await tx.kycDocument.create({ data: { ownerType, ownerId, docType: input.docType, expiryDate: input.expiryDate ? new Date(`${input.expiryDate}T00:00:00Z`) : null, uploadedById: uid(req), ...file } });
      await audit({ action: 'kyc.document_uploaded', entityType: ownerType.toLowerCase(), entityId: ownerId, module: 'documents', actorType: 'EMPLOYEE', metadata: { docType: input.docType }, req }, tx);
      return d;
    });
    created(res, 'Document uploaded', { document: { id: doc.id, status: doc.status } });
  } catch (e) {
    await storage.remove(file.storageKey);
    throw e;
  }
}

onboardingRouter.post('/transporters/:id/documents', can('transporters', 'create'), multipart({ field: 'file' }), async (req: Request, res: Response) => {
  const id = idOf(req);
  await assertInScope(req, 'TRANSPORTER', id);
  if (!(await prisma.agency.count({ where: { id } }))) throw AppError.notFound('Transporter not found');
  await kycUpload(req, res, 'TRANSPORTER', id, ['BUSINESS_REGISTRATION', 'GST_CERTIFICATE', 'PAN_DOCUMENT', 'TRANSPORT_PERMIT', 'OTHER']);
});

/** Fleet information captured during onboarding. Always starts unverified. */
onboardingRouter.post('/transporters/:id/tankers', can('tankers', 'create'), async (req: Request, res: Response) => {
  const id = idOf(req);
  await assertInScope(req, 'TRANSPORTER', id);
  const input = body(req, z.object({ registrationNumber: z.string().trim().toUpperCase().regex(/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/, 'Enter a valid registration number'), capacityKl: z.number().positive().max(100), tankerTypeId: z.string().uuid(), compartments: z.number().int().min(1).max(12).default(1), productIds: z.array(z.string().uuid()).min(1) }).strict());
  if (!(await prisma.agency.count({ where: { id } }))) throw AppError.notFound('Transporter not found');
  const { productIds, ...data } = input;
  const t = await prisma.$transaction(async (tx) => {
    const row = await tx.tanker.create({ data: { ...data, transporterId: id, products: { create: [...new Set(productIds)].map((productId) => ({ productId })) } } });
    await audit({ action: 'tanker.created_by_employee', entityType: 'tanker', entityId: row.id, module: 'tankers', actorType: 'EMPLOYEE', metadata: { registrationNumber: row.registrationNumber }, req }, tx);
    return row;
  });
  created(res, 'Tanker added (pending verification)', { tanker: { id: t.id, registrationNumber: t.registrationNumber } });
});

onboardingRouter.post('/tankers/:id/documents', can('tankers', 'create'), multipart({ field: 'file' }), async (req: Request, res: Response) => {
  const id = idOf(req);
  const t = await prisma.tanker.findUnique({ where: { id }, select: { transporterId: true } });
  if (!t) throw AppError.notFound('Tanker not found');
  await assertInScope(req, 'TRANSPORTER', t.transporterId);
  await kycUpload(req, res, 'TANKER', id, ['REGISTRATION_CERTIFICATE', 'INSURANCE', 'FITNESS_CERTIFICATE', 'PUC', 'PERMIT', 'PESO', 'OTHER']);
});

// ---- Drivers ------------------------------------------------------------------------------------

onboardingRouter.post('/drivers', can('drivers', 'create'), async (req: Request, res: Response) => {
  const driver = await registerDriver(req, body(req, driverSchema));
  created(res, 'Driver registered under the transporter (pending verification)', { driver: { id: driver.id, verificationStatus: driver.verificationStatus } });
});

onboardingRouter.get('/drivers', can('drivers', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { status: z.string().optional() });
  const ids = await assignedIds(req, 'TRANSPORTER');
  const where: Prisma.DriverWhereInput = { ...(ids ? { agencyId: { in: ids } } : {}), ...(q.status ? { verificationStatus: q.status as never } : {}), ...(q.q ? { OR: [{ licenceNumber: insensitive(q.q) }, { user: { fullName: insensitive(q.q) } }] } : {}) };
  const [total, items] = await Promise.all([prisma.driver.count({ where }), prisma.driver.findMany({ where, orderBy: { createdAt: 'desc' }, ...win(q, true), select: { id: true, licenceNumber: true, licenceExpiry: true, verificationStatus: true, rejectionReason: true, hazardousTraining: true, user: { select: { fullName: true, phone: true } }, agency: { select: { companyName: true } } } })]);
  ok(res, 'Drivers', { total, page: q.page, pageSize: q.pageSize, items });
});

onboardingRouter.post('/drivers/:id/documents', can('drivers', 'create'), multipart({ field: 'file' }), async (req: Request, res: Response) => {
  const id = idOf(req);
  const d = await prisma.driver.findUnique({ where: { id }, select: { agencyId: true } });
  if (!d) throw AppError.notFound('Driver not found');
  await assertInScope(req, 'TRANSPORTER', d.agencyId);
  await kycUpload(req, res, 'DRIVER', id, ['DRIVING_LICENCE', 'IDENTITY_PROOF', 'ADDRESS_PROOF', 'HAZMAT_TRAINING', 'OTHER']);
});

/** Pick lists for forms: only what the caller could already reach. */
onboardingRouter.get('/directory', async (req: Request, res: Response) => {
  const canPickStaff = hasPermission(req, 'leads', 'assign') || hasPermission(req, 'tasks', 'assign') || hasPermission(req, 'companies', 'assign') || hasPermission(req, 'complaints', 'assign');
  const ids = await assignedIds(req, 'TRANSPORTER');
  const [employees, transporters] = await Promise.all([
    canPickStaff ? prisma.employee.findMany({ where: { employmentStatus: 'ACTIVE' }, orderBy: { employeeCode: 'asc' }, select: { id: true, employeeCode: true, user: { select: { fullName: true } } } }) : [],
    hasPermission(req, 'drivers', 'create') ? prisma.agency.findMany({ where: ids ? { id: { in: ids } } : {}, orderBy: { companyName: 'asc' }, take: 500, select: { id: true, companyName: true, transporterCode: true } }) : [],
  ]);
  ok(res, 'Directory', { employees: employees.map((e) => ({ id: e.id, label: `${e.user.fullName} (${e.employeeCode})` })), transporters: transporters.map((t) => ({ id: t.id, label: `${t.companyName} (${t.transporterCode})` })) });
});

