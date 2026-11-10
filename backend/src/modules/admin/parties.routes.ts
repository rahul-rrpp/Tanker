import { notifyTransporter } from '../notifications/notification.service';
import { Prisma } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { nextCode } from '../../lib/codes';
import { AppError, ErrorCode } from '../../utils/errors';
import { buildGstin, validateGstin } from '../../utils/gst';
import { created, ok } from '../../utils/response';
import { emailSchema, fullNameSchema, panSchema, phoneSchema, pincodeSchema } from '../../utils/validators';
import { audit } from '../audit/audit';
import { notify } from '../notifications/notification.service';
import { adminAuth, assertInScope, assignedIds, body, can, dateRange, idOf, insensitive, orderBy, parseList, win, recordReview, respondList, type Column } from './core';

void buildGstin;

/** Shared: who currently owns an entity. */
export async function ownersFor(entityType: 'COMPANY' | 'TRANSPORTER', ids: string[]) {
  const rows = await prisma.employeeAssignment.findMany({
    where: { entityType, entityId: { in: ids }, endedAt: null },
    select: { entityId: true, employee: { select: { id: true, employeeCode: true, user: { select: { fullName: true } } } } },
  });
  return new Map(rows.map((r) => [r.entityId, { id: r.employee.id, code: r.employee.employeeCode, name: r.employee.user.fullName }]));
}

/** Shared: assign an entity to an employee (ends the previous assignment, keeps history). */
export async function assignEntity(req: Request, entityType: 'COMPANY' | 'TRANSPORTER', entityId: string, employeeId: string | null) {
  await prisma.$transaction(async (tx) => {
    const prev = await tx.employeeAssignment.findFirst({ where: { entityType, entityId, endedAt: null } });
    if (employeeId) {
      const emp = await tx.employee.findUnique({ where: { id: employeeId }, select: { employmentStatus: true } });
      if (!emp || emp.employmentStatus !== 'ACTIVE') throw AppError.badRequest('Select an active employee');
    }
    if (prev?.employeeId === employeeId) return;
    if (prev) await tx.employeeAssignment.update({ where: { id: prev.id }, data: { endedAt: new Date() } });
    if (employeeId) await tx.employeeAssignment.create({ data: { entityType, entityId, employeeId, assignedById: req.admin!.userId } });
    await audit({ action: `${entityType.toLowerCase()}.assigned`, entityType: entityType.toLowerCase(), entityId, module: entityType === 'COMPANY' ? 'companies' : 'transporters', previousValue: { employeeId: prev?.employeeId ?? null }, newValue: { employeeId }, req }, tx);
  });
}

export async function addNote(req: Request, entityType: string, entityId: string, note: string) {
  const row = await prisma.entityNote.create({ data: { entityType, entityId, note, authorId: req.admin!.userId } });
  await audit({ action: 'note.added', entityType: entityType.toLowerCase(), entityId, module: 'notes', metadata: { noteId: row.id }, req });
  return row;
}

export async function notesFor(entityType: string, entityId: string) {
  const notes = await prisma.entityNote.findMany({ where: { entityType, entityId }, orderBy: { createdAt: 'desc' } });
  const authors = new Map((await prisma.user.findMany({ where: { id: { in: notes.map((n) => n.authorId!).filter(Boolean) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  return notes.map((n) => ({ ...n, author: n.authorId ? authors.get(n.authorId) ?? 'Unknown' : 'System' }));
}

export async function reviewHistory(entityType: string, entityId: string) {
  const rows = await prisma.verificationReview.findMany({ where: { entityType, entityId }, orderBy: { createdAt: 'desc' } });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.reviewerId!).filter(Boolean) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({ ...r, reviewer: r.reviewerId ? users.get(r.reviewerId) ?? 'Unknown' : 'System' }));
}

export async function activityFor(entityType: string, entityId: string, companyId?: string) {
  return prisma.auditLog.findMany({
    where: companyId ? { OR: [{ entityType, entityId }, { companyId }] } : { entityType, entityId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, action: true, module: true, actorType: true, actorRole: true, metadata: true, previousValue: true, newValue: true, ipAddress: true, createdAt: true, actor: { select: { fullName: true } } },
  });
}

const sum = (v: Prisma.Decimal | null | undefined) => (v ? v.toNumber() : 0);

// ===========================================================================
// Companies
// ===========================================================================

export const adminCompaniesRouter = Router();
adminCompaniesRouter.use(...adminAuth);

const companyColumns: Column[] = [
  { key: 'companyCode', label: 'Company ID', format: 'text' },
  { key: 'name', label: 'Company name', format: 'text' },
  { key: 'contactPersonName', label: 'Contact person', format: 'text' },
  { key: 'contactPhone', label: 'Mobile', format: 'text' },
  { key: 'contactEmail', label: 'Email', format: 'text' },
  { key: 'gstNumber', label: 'GST number', format: 'text' },
  { key: 'city', label: 'City', format: 'text' },
  { key: 'state', label: 'State', format: 'text' },
  { key: 'createdAt', label: 'Registered', format: 'date' },
  { key: 'verificationStatus', label: 'Verification', format: 'text' },
  { key: 'bookings', label: 'Bookings', format: 'number' },
  { key: 'freight', label: 'Freight value', format: 'currency' },
  { key: 'assignedEmployee', label: 'Assigned employee', format: 'text' },
  { key: 'accountStatus', label: 'Account status', format: 'text' },
];

const companyVerification = (c: { status: string; statusBeforeSuspension: string | null }) => (c.status === 'SUSPENDED' ? (c.statusBeforeSuspension ?? 'VERIFIED') : c.status);

adminCompaniesRouter.get('/', can('companies', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { status: z.string().optional(), account: z.enum(['ACTIVE', 'SUSPENDED']).optional(), state: z.string().optional(), city: z.string().optional(), employeeId: z.string().uuid().optional() });
  const scoped = await assignedIds(req, 'COMPANY');
  const byEmployee = q.employeeId ? (await prisma.employeeAssignment.findMany({ where: { entityType: 'COMPANY', employeeId: q.employeeId as string, endedAt: null }, select: { entityId: true } })).map((a) => a.entityId) : null;
  const idFilter = [scoped, byEmployee].filter(Boolean) as string[][];
  const where: Prisma.CompanyWhereInput = {
    ...(idFilter.length ? { id: { in: idFilter.reduce((a, b) => a.filter((x) => b.includes(x))) } } : {}),
    ...(q.status ? { OR: [{ status: q.status as never, statusBeforeSuspension: null }, { status: 'SUSPENDED', statusBeforeSuspension: q.status as never }] } : {}),
    ...(q.account === 'SUSPENDED' ? { status: 'SUSPENDED' } : q.account === 'ACTIVE' ? { status: { not: 'SUSPENDED' } } : {}),
    ...(q.state ? { addresses: { some: { type: 'REGISTERED', state: insensitive(q.state as string) } } } : {}),
    ...(q.city ? { addresses: { some: { type: 'REGISTERED', city: insensitive(q.city as string) } } } : {}),
    ...(q.from || q.to ? { createdAt: dateRange(q) } : {}),
    ...(q.q ? { AND: [{ OR: [{ name: insensitive(q.q) }, { companyCode: insensitive(q.q) }, { gstNumber: insensitive(q.q) }, { contactPhone: { contains: q.q } }, { contactEmail: insensitive(q.q) }] }] } : {}),
  };
  const load = async (paged: boolean) => {
    const rows = await prisma.company.findMany({
      where,
      orderBy: orderBy(q, ['createdAt', 'name', 'companyCode', 'status'], 'createdAt'),
      ...win(q, paged),
      include: { addresses: { where: { type: 'REGISTERED' }, select: { city: true, state: true } } },
    });
    const ids = rows.map((r) => r.id);
    const [counts, owners] = await Promise.all([
      prisma.booking.groupBy({ by: ['companyId'], where: { companyId: { in: ids } }, _count: { _all: true }, _sum: { acceptedFreight: true } }),
      ownersFor('COMPANY', ids),
    ]);
    const cm = new Map(counts.map((c) => [c.companyId, c]));
    return rows.map((c) => ({
      id: c.id,
      companyCode: c.companyCode,
      name: c.name,
      contactPersonName: c.contactPersonName,
      contactPhone: c.contactPhone,
      contactEmail: c.contactEmail,
      gstNumber: c.gstNumber,
      city: c.addresses[0]?.city ?? null,
      state: c.addresses[0]?.state ?? null,
      createdAt: c.createdAt,
      verificationStatus: companyVerification(c),
      accountStatus: c.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
      bookings: cm.get(c.id)?._count._all ?? 0,
      freight: sum(cm.get(c.id)?._sum.acceptedFreight),
      assignedEmployee: owners.get(c.id)?.name ?? null,
      assignedEmployeeId: owners.get(c.id)?.id ?? null,
      isDemo: c.isDemo,
    }));
  };
  const [total, rows] = await Promise.all([prisma.company.count({ where }), load(true)]);
  await respondList(req, res, { title: 'Companies', q, columns: companyColumns, total, rows, exportRows: () => load(false), module: 'companies' });
});

const companyCreateSchema = z.object({
  companyName: z.string().trim().min(2).max(160),
  contactPersonName: fullNameSchema,
  phone: phoneSchema,
  email: emailSchema,
  gstNumber: z.string().trim().toUpperCase(),
  businessType: z.enum(['MANUFACTURER', 'TRADER', 'DISTRIBUTOR', 'OIL_MARKETING_COMPANY', 'REFINERY', 'PETROL_PUMP_DEALER', 'INDUSTRIAL_CONSUMER', 'LOGISTICS_PROVIDER', 'OTHER']),
  address: z.string().trim().min(5).max(300),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  pincode: pincodeSchema,
  leadId: z.string().uuid().optional(),
});

/** Registration on behalf of a company (sales). The login has no password: the company signs in with OTP or sets one via "Forgot password". */
export async function createCompanyOnBehalf(req: Request, input: z.infer<typeof companyCreateSchema>) {
  const gst = validateGstin(input.gstNumber, input.state);
  if (!gst.valid) throw AppError.badRequest(gst.reason, ErrorCode.VALIDATION_ERROR, [{ field: 'gstNumber', message: gst.reason }]);
  const dup = await prisma.user.findFirst({ where: { OR: [{ phone: input.phone }, { email: input.email }] }, select: { id: true } });
  if (dup) throw AppError.conflict('A user with this mobile number or email already exists', ErrorCode.PHONE_ALREADY_REGISTERED);
  if (await prisma.company.findUnique({ where: { gstNumber: input.gstNumber } })) throw AppError.conflict('A company with this GST number is already registered', ErrorCode.GST_ALREADY_REGISTERED);
  const roleId = (await prisma.role.findUniqueOrThrow({ where: { name: 'COMPANY_ADMIN' } })).id;
  const company = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { fullName: input.contactPersonName, phone: input.phone, email: input.email, accountStatus: 'ACTIVE', isPhoneVerified: false, roles: { create: { roleId } } },
    });
    const c = await tx.company.create({
      data: {
        companyCode: await nextCode(tx, 'company'),
        name: input.companyName,
        gstNumber: input.gstNumber,
        panNumber: input.gstNumber.slice(2, 12),
        businessType: input.businessType,
        contactPersonName: input.contactPersonName,
        contactPhone: input.phone,
        contactEmail: input.email,
        termsAcceptedAt: new Date(),
        createdById: req.admin!.userId,
        members: { create: { userId: user.id, role: 'COMPANY_ADMIN' } },
        addresses: { create: { type: 'REGISTERED', address: input.address, city: input.city, state: input.state, pincode: input.pincode } },
        contacts: { create: { name: input.contactPersonName, phone: input.phone, email: input.email, isPrimary: true } },
      },
    });
    if (req.admin!.employeeId) await tx.employeeAssignment.create({ data: { entityType: 'COMPANY', entityId: c.id, employeeId: req.admin!.employeeId, assignedById: req.admin!.userId } });
    await audit({ action: 'company.created_by_admin', entityType: 'company', entityId: c.id, companyId: c.id, module: 'companies', newValue: { companyCode: c.companyCode, name: c.name }, req }, tx);
    return c;
  });
  return company;
}

adminCompaniesRouter.post('/', can('companies', 'create'), async (req: Request, res: Response) => {
  const input = body(req, companyCreateSchema);
  const company = await createCompanyOnBehalf(req, input);
  created(res, `Company ${company.companyCode} registered. The contact can sign in with an OTP on their mobile.`, { company });
});

adminCompaniesRouter.get('/:id', can('companies', 'view'), async (req: Request, res: Response) => {
  const id = idOf(req);
  await assertInScope(req, 'COMPANY', id);
  const c = await prisma.company.findUnique({
    where: { id },
    include: {
      addresses: true,
      contacts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
      documents: { orderBy: { createdAt: 'desc' } },
      members: { include: { user: { select: { id: true, fullName: true, phone: true, email: true, lastLoginAt: true, accountStatus: true } } } },
    },
  });
  if (!c) throw AppError.notFound('Company not found');
  const [stats, payments, owner, reviews, subs] = await Promise.all([
    prisma.booking.aggregate({ where: { companyId: id }, _count: { _all: true }, _sum: { acceptedFreight: true } }),
    prisma.payment.aggregate({ where: { companyId: id, status: 'PAID' }, _sum: { amount: true } }),
    ownersFor('COMPANY', [id]),
    reviewHistory('COMPANY', id),
    prisma.subscription.findMany({ where: { companyId: id }, include: { plan: { select: { name: true } } }, orderBy: { startAt: 'desc' } }),
  ]);
  ok(res, 'Company', {
    company: { ...c, verificationStatus: companyVerification(c), accountStatus: c.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE' },
    stats: { bookings: stats._count._all, freight: sum(stats._sum.acceptedFreight), paid: sum(payments._sum.amount) },
    assignedEmployee: owner.get(id) ?? null,
    verificationHistory: reviews,
    subscriptions: subs,
  });
});

/** Detail tabs that can be large are fetched separately. */
adminCompaniesRouter.get('/:id/tab/:tab', can('companies', 'view'), async (req: Request, res: Response) => {
  const id = idOf(req);
  await assertInScope(req, 'COMPANY', id);
  const tab = String(req.params.tab);
  switch (tab) {
    case 'bookings':
      return ok(res, 'Bookings', {
        items: await prisma.booking.findMany({
          where: { companyId: id },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: { id: true, bookingCode: true, status: true, createdAt: true, customerOffer: true, acceptedFreight: true, source: true, product: { select: { name: true } }, locations: { select: { type: true, city: true } } },
        }),
      });
    case 'payments':
      return ok(res, 'Payments', { items: await prisma.payment.findMany({ where: { companyId: id }, orderBy: { createdAt: 'desc' }, take: 200, include: { booking: { select: { bookingCode: true } } } }) });
    case 'complaints':
      return ok(res, 'Complaints', { items: await prisma.supportTicket.findMany({ where: { companyId: id }, orderBy: { createdAt: 'desc' }, include: { booking: { select: { bookingCode: true } } } }) });
    case 'activity':
      return ok(res, 'Activity', { items: await activityFor('company', id, id) });
    case 'notes':
      return ok(res, 'Notes', { items: await notesFor('COMPANY', id) });
    default:
      throw AppError.notFound('Unknown tab');
  }
});

const companyEditSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    panNumber: panSchema.optional(),
    businessType: companyCreateSchema.shape.businessType.optional(),
    industry: z.string().trim().max(80).optional(),
    website: z.string().trim().max(200).optional(),
    contactPersonName: fullNameSchema.optional(),
    contactPhone: phoneSchema.optional(),
    contactEmail: emailSchema.optional(),
  })
  .strict();

adminCompaniesRouter.put('/:id', can('companies', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  await assertInScope(req, 'COMPANY', id);
  const input = body(req, companyEditSchema);
  const before = await prisma.company.findUnique({ where: { id } });
  if (!before) throw AppError.notFound('Company not found');
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.company.update({ where: { id }, data: input });
    const prev = Object.fromEntries(Object.keys(input).map((k) => [k, (before as Record<string, unknown>)[k] ?? null]));
    await audit({ action: 'company.updated_by_admin', entityType: 'company', entityId: id, companyId: id, module: 'companies', previousValue: prev as Prisma.InputJsonValue, newValue: input as Prisma.InputJsonValue, req }, tx);
    return u;
  });
  ok(res, 'Company updated', { company: updated });
});

const reviewSchema = z.object({ action: z.enum(['START_REVIEW', 'APPROVE', 'REJECT']), reason: z.string().trim().max(500).optional() }).strict();

adminCompaniesRouter.post('/:id/review', async (req: Request, res: Response) => {
  const id = idOf(req);
  const { action, reason } = body(req, reviewSchema);
  const perm = action === 'REJECT' ? 'reject' : action === 'APPROVE' ? 'approve' : 'edit';
  await new Promise<void>((resolve, reject) => can('companies', perm)(req, res, (e?: unknown) => (e ? reject(e) : resolve())));
  await assertInScope(req, 'COMPANY', id);
  if (action === 'REJECT' && (!reason || reason.length < 5)) throw AppError.badRequest('A rejection reason is required', ErrorCode.VALIDATION_ERROR, [{ field: 'reason', message: 'Explain why the verification was rejected' }]);
  const c = await prisma.company.findUnique({ where: { id } });
  if (!c) throw AppError.notFound('Company not found');
  if (c.status === 'SUSPENDED') throw AppError.conflict('Reactivate the company before changing its verification', ErrorCode.INVALID_STATE_TRANSITION);
  const to = action === 'START_REVIEW' ? 'UNDER_REVIEW' : action === 'APPROVE' ? 'VERIFIED' : 'REJECTED';
  const allowed: Record<string, string[]> = { UNDER_REVIEW: ['PENDING_VERIFICATION', 'REJECTED'], VERIFIED: ['PENDING_VERIFICATION', 'UNDER_REVIEW', 'REJECTED'], REJECTED: ['PENDING_VERIFICATION', 'UNDER_REVIEW', 'VERIFIED'] };
  if (!allowed[to].includes(c.status)) throw AppError.conflict(`Cannot move from ${c.status} to ${to}`, ErrorCode.INVALID_STATE_TRANSITION);
  await prisma.$transaction(async (tx) => {
    await tx.company.update({ where: { id }, data: { status: to, statusReason: to === 'REJECTED' ? reason : null, verifiedAt: to === 'VERIFIED' ? new Date() : c.verifiedAt } });
    await recordReview(tx, { entityType: 'COMPANY', entityId: id, fromStatus: c.status, toStatus: to, reason, reviewerId: req.admin!.userId });
    await audit({ action: `company.${to.toLowerCase()}`, entityType: 'company', entityId: id, companyId: id, module: 'companies', previousValue: { status: c.status }, newValue: { status: to, reason: reason ?? null }, req }, tx);
  });
  if (to !== 'UNDER_REVIEW') {
    await notify({
      companyId: id,
      type: 'COMPANY_VERIFICATION_UPDATE',
      title: to === 'VERIFIED' ? 'Your company is verified' : 'Company verification rejected',
      message: to === 'VERIFIED' ? 'You can now submit booking requests on TankerLink.' : `Reason: ${reason}. Update your documents in Company Profile and we will review again.`,
      link: '/company/profile',
    });
  }
  ok(res, `Company ${to.replace('_', ' ').toLowerCase()}`, { status: to });
});

adminCompaniesRouter.post('/:id/suspend', can('companies', 'approve'), async (req: Request, res: Response) => {
  const id = idOf(req);
  await assertInScope(req, 'COMPANY', id);
  const { reason } = body(req, z.object({ reason: z.string().trim().min(5, 'Give a reason').max(500) }));
  const c = await prisma.company.findUnique({ where: { id }, include: { members: true } });
  if (!c) throw AppError.notFound('Company not found');
  if (c.status === 'SUSPENDED') throw AppError.conflict('Company is already suspended');
  await prisma.$transaction(async (tx) => {
    await tx.company.update({ where: { id }, data: { status: 'SUSPENDED', statusBeforeSuspension: c.status, suspensionReason: reason } });
    // End every active session of the company's users immediately.
    await tx.refreshSession.updateMany({ where: { userId: { in: c.members.map((m) => m.userId) }, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'COMPANY_SUSPENDED' } });
    await recordReview(tx, { entityType: 'COMPANY', entityId: id, fromStatus: c.status, toStatus: 'SUSPENDED', reason, reviewerId: req.admin!.userId });
    await audit({ action: 'company.suspended', entityType: 'company', entityId: id, companyId: id, module: 'companies', previousValue: { status: c.status }, newValue: { status: 'SUSPENDED', reason }, req }, tx);
  });
  ok(res, 'Company suspended', null);
});

adminCompaniesRouter.post('/:id/reactivate', can('companies', 'approve'), async (req: Request, res: Response) => {
  const id = idOf(req);
  await assertInScope(req, 'COMPANY', id);
  const c = await prisma.company.findUnique({ where: { id } });
  if (!c) throw AppError.notFound('Company not found');
  if (c.status !== 'SUSPENDED') throw AppError.conflict('Company is not suspended');
  const to = c.statusBeforeSuspension ?? 'PENDING_VERIFICATION';
  await prisma.$transaction(async (tx) => {
    await tx.company.update({ where: { id }, data: { status: to, statusBeforeSuspension: null, suspensionReason: null } });
    await recordReview(tx, { entityType: 'COMPANY', entityId: id, fromStatus: 'SUSPENDED', toStatus: to, reason: 'Reactivated', reviewerId: req.admin!.userId });
    await audit({ action: 'company.reactivated', entityType: 'company', entityId: id, companyId: id, module: 'companies', previousValue: { status: 'SUSPENDED' }, newValue: { status: to }, req }, tx);
  });
  ok(res, 'Company reactivated', { status: to });
});

adminCompaniesRouter.post('/:id/assign', can('companies', 'assign'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const { employeeId } = body(req, z.object({ employeeId: z.string().uuid().nullable() }));
  if (!(await prisma.company.findUnique({ where: { id }, select: { id: true } }))) throw AppError.notFound('Company not found');
  await assignEntity(req, 'COMPANY', id, employeeId);
  ok(res, employeeId ? 'Employee assigned' : 'Assignment removed', null);
});

adminCompaniesRouter.post('/:id/notes', can('companies', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  await assertInScope(req, 'COMPANY', id);
  const { note } = body(req, z.object({ note: z.string().trim().min(2).max(2000) }));
  created(res, 'Note added', { note: await addNote(req, 'COMPANY', id, note) });
});

// ===========================================================================
// Transporters (Agency) - records are compatible with the future Transporter Login
// ===========================================================================

export const adminTransportersRouter = Router();
adminTransportersRouter.use(...adminAuth);

const transporterVerification = (t: { verificationStatus: string; statusBeforeSuspension: string | null }) =>
  t.verificationStatus === 'SUSPENDED' ? (t.statusBeforeSuspension ?? 'APPROVED') : t.verificationStatus;

const transporterColumns: Column[] = [
  { key: 'code', label: 'Transporter ID', format: 'text' },
  { key: 'companyName', label: 'Company name', format: 'text' },
  { key: 'ownerName', label: 'Owner', format: 'text' },
  { key: 'phone', label: 'Mobile', format: 'text' },
  { key: 'email', label: 'Email', format: 'text' },
  { key: 'gstNumber', label: 'GST', format: 'text' },
  { key: 'city', label: 'City', format: 'text' },
  { key: 'state', label: 'State', format: 'text' },
  { key: 'tankers', label: 'Tankers', format: 'number' },
  { key: 'drivers', label: 'Drivers', format: 'number' },
  { key: 'activeTrips', label: 'Active trips', format: 'number' },
  { key: 'completedTrips', label: 'Completed trips', format: 'number' },
  { key: 'verificationStatus', label: 'Verification', format: 'text' },
  { key: 'accountStatus', label: 'Account', format: 'text' },
  { key: 'createdAt', label: 'Registered', format: 'date' },
];

const tCode = (id: string) => `TRN-${id.slice(0, 8).toUpperCase()}`;

adminTransportersRouter.get('/', can('transporters', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { status: z.string().optional(), account: z.enum(['ACTIVE', 'SUSPENDED']).optional(), state: z.string().optional(), city: z.string().optional() });
  const scoped = await assignedIds(req, 'TRANSPORTER');
  const where: Prisma.AgencyWhereInput = {
    ...(scoped ? { id: { in: scoped } } : {}),
    ...(q.status ? { OR: [{ verificationStatus: q.status as never, statusBeforeSuspension: null }, { verificationStatus: 'SUSPENDED', statusBeforeSuspension: q.status as never }] } : {}),
    ...(q.account === 'SUSPENDED' ? { verificationStatus: 'SUSPENDED' } : q.account === 'ACTIVE' ? { verificationStatus: { not: 'SUSPENDED' } } : {}),
    ...(q.state ? { state: insensitive(q.state as string) } : {}),
    ...(q.city ? { city: insensitive(q.city as string) } : {}),
    ...(q.from || q.to ? { createdAt: dateRange(q) } : {}),
    ...(q.q ? { AND: [{ OR: [{ companyName: insensitive(q.q) }, { gstNumber: insensitive(q.q) }, { owner: { phone: { contains: q.q } } }, { owner: { fullName: insensitive(q.q) } }] }] } : {}),
  };
  const load = async (paged: boolean) => {
    const rows = await prisma.agency.findMany({
      where,
      orderBy: orderBy(q, ['createdAt', 'companyName', 'rating', 'completedTrips'], 'createdAt'),
      ...win(q, paged),
      include: { owner: { select: { fullName: true, phone: true, email: true } }, _count: { select: { tankers: true, drivers: true } } },
    });
    const ids = rows.map((r) => r.id);
    const active = await prisma.trip.groupBy({ by: ['transporterId'], where: { transporterId: { in: ids }, status: { notIn: ['COMPLETED', 'CANCELLED', 'DELIVERED'] } }, _count: { _all: true } });
    const am = new Map(active.map((a) => [a.transporterId, a._count._all]));
    return rows.map((t) => ({
      id: t.id,
      code: tCode(t.id),
      companyName: t.companyName,
      ownerName: t.owner.fullName,
      phone: t.owner.phone,
      email: t.owner.email,
      gstNumber: t.gstNumber,
      city: t.city,
      state: t.state,
      tankers: t._count.tankers,
      drivers: t._count.drivers,
      activeTrips: am.get(t.id) ?? 0,
      completedTrips: t.completedTrips,
      verificationStatus: transporterVerification(t),
      accountStatus: t.verificationStatus === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
      rating: t.rating,
      createdAt: t.createdAt,
      isDemo: t.isDemo,
    }));
  };
  const [total, rows] = await Promise.all([prisma.agency.count({ where }), load(true)]);
  await respondList(req, res, { title: 'Transporters', q, columns: transporterColumns, total, rows, exportRows: () => load(false), module: 'transporters' });
});

const transporterCreateSchema = z.object({
  companyName: z.string().trim().min(2).max(160),
  ownerName: fullNameSchema,
  phone: phoneSchema,
  email: emailSchema,
  panNumber: panSchema,
  gstNumber: z.string().trim().toUpperCase().optional().or(z.literal('').transform(() => undefined)),
  address: z.string().trim().min(5).max(300),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  pincode: pincodeSchema,
  category: z.string().trim().max(40).optional(),
  serviceStates: z.array(z.string().trim().max(80)).max(36).default([]),
  leadId: z.string().uuid().optional(),
});

export async function createTransporterOnBehalf(req: Request, input: z.infer<typeof transporterCreateSchema>) {
  if (input.gstNumber) {
    const g = validateGstin(input.gstNumber, input.state);
    if (!g.valid) throw AppError.badRequest(g.reason, ErrorCode.VALIDATION_ERROR, [{ field: 'gstNumber', message: g.reason }]);
    if (g.pan !== input.panNumber) throw AppError.badRequest('GSTIN does not match the PAN', ErrorCode.VALIDATION_ERROR, [{ field: 'gstNumber', message: 'GSTIN does not match the PAN' }]);
  }
  const dup = await prisma.user.findFirst({ where: { OR: [{ phone: input.phone }, { email: input.email }] }, select: { id: true } });
  if (dup) throw AppError.conflict('A user with this mobile number or email already exists', ErrorCode.PHONE_ALREADY_REGISTERED);
  if (await prisma.agency.findFirst({ where: { OR: [{ panNumber: input.panNumber }, ...(input.gstNumber ? [{ gstNumber: input.gstNumber }] : [])] } })) {
    throw AppError.conflict('A transporter with this PAN/GST is already registered');
  }
  const roleId = (await prisma.role.findUniqueOrThrow({ where: { name: 'AGENCY_OWNER' } })).id;
  return prisma.$transaction(async (tx) => {
    // Owner login without a password: compatible with the future Transporter Portal (OTP / reset to activate).
    const owner = await tx.user.create({ data: { fullName: input.ownerName, phone: input.phone, email: input.email, accountStatus: 'ACTIVE', roles: { create: { roleId } } } });
    const t = await tx.agency.create({
      data: {
        companyName: input.companyName,
        ownerId: owner.id,
        panNumber: input.panNumber,
        gstNumber: input.gstNumber ?? null,
        address: input.address,
        city: input.city,
        state: input.state,
        pincode: input.pincode,
        category: input.category,
        serviceStates: input.serviceStates,
        termsAcceptedAt: new Date(),
        createdById: req.admin!.userId,
        members: { create: { userId: owner.id, role: 'AGENCY_OWNER' } },
      },
    });
    if (req.admin!.employeeId) await tx.employeeAssignment.create({ data: { entityType: 'TRANSPORTER', entityId: t.id, employeeId: req.admin!.employeeId, assignedById: req.admin!.userId } });
    await audit({ action: 'transporter.created_by_admin', entityType: 'transporter', entityId: t.id, module: 'transporters', newValue: { companyName: t.companyName }, req }, tx);
    return t;
  });
}

adminTransportersRouter.post('/', can('transporters', 'create'), async (req: Request, res: Response) => {
  const t = await createTransporterOnBehalf(req, body(req, transporterCreateSchema));
  created(res, 'Transporter registered (pending verification)', { transporter: t });
});

adminTransportersRouter.get('/:id', can('transporters', 'view'), async (req: Request, res: Response) => {
  const id = idOf(req);
  await assertInScope(req, 'TRANSPORTER', id);
  const t = await prisma.agency.findUnique({ where: { id }, include: { owner: { select: { id: true, fullName: true, phone: true, email: true, lastLoginAt: true, passwordHash: true } }, _count: { select: { tankers: true, drivers: true, offers: true } } } });
  if (!t) throw AppError.notFound('Transporter not found');
  const [owner, reviews, earnings, commission, trips] = await Promise.all([
    ownersFor('TRANSPORTER', [id]),
    reviewHistory('TRANSPORTER', id),
    prisma.bookingAllocation.aggregate({ where: { transporterId: id, status: { not: 'CANCELLED' } }, _sum: { agreedFreight: true }, _count: { _all: true } }),
    prisma.bookingCommission.aggregate({ where: { transporterId: id }, _sum: { commissionAmount: true, transporterPayable: true } }),
    prisma.trip.groupBy({ by: ['status'], where: { transporterId: id }, _count: { _all: true } }),
  ]);
  const { passwordHash, ...ownerSafe } = t.owner;
  ok(res, 'Transporter', {
    transporter: { ...t, owner: { ...ownerSafe, hasLogin: Boolean(passwordHash) }, code: tCode(t.id), verification: transporterVerification(t), accountStatus: t.verificationStatus === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE' },
    assignedEmployee: owner.get(id) ?? null,
    verificationHistory: reviews,
    stats: {
      allocations: earnings._count._all,
      grossFreight: sum(earnings._sum.agreedFreight),
      commission: sum(commission._sum.commissionAmount),
      payable: sum(commission._sum.transporterPayable),
      tripsByStatus: Object.fromEntries(trips.map((x) => [x.status, x._count._all])),
    },
  });
});

adminTransportersRouter.get('/:id/tab/:tab', can('transporters', 'view'), async (req: Request, res: Response) => {
  const id = idOf(req);
  await assertInScope(req, 'TRANSPORTER', id);
  const tab = String(req.params.tab);
  switch (tab) {
    case 'fleet':
      return ok(res, 'Fleet', { items: await prisma.tanker.findMany({ where: { transporterId: id }, include: { tankerType: { select: { name: true } }, products: { select: { product: { select: { name: true } } } }, assignedDriver: { select: { user: { select: { fullName: true } } } } } }) });
    case 'drivers':
      return ok(res, 'Drivers', { items: await prisma.driver.findMany({ where: { agencyId: id }, include: { user: { select: { fullName: true, phone: true, accountStatus: true } }, assignedTanker: { select: { registrationNumber: true } } } }) });
    case 'documents':
      return ok(res, 'Documents', { items: await prisma.kycDocument.findMany({ where: { ownerType: 'TRANSPORTER', ownerId: id }, orderBy: { createdAt: 'desc' } }) });
    case 'offers':
      return ok(res, 'Offers', { items: await prisma.transporterOffer.findMany({ where: { transporterId: id }, orderBy: { createdAt: 'desc' }, take: 200, include: { booking: { select: { id: true, bookingCode: true, customerOffer: true } } } }) });
    case 'trips':
      return ok(res, 'Trips', { items: await prisma.trip.findMany({ where: { transporterId: id }, orderBy: { createdAt: 'desc' }, take: 200, include: { booking: { select: { id: true, bookingCode: true } }, tanker: { select: { registrationNumber: true } }, driver: { select: { user: { select: { fullName: true } } } } } }) });
    case 'payments':
      return ok(res, 'Settlements', { items: await prisma.settlement.findMany({ where: { transporterId: id }, orderBy: { createdAt: 'desc' }, take: 200 }) });
    case 'commission':
      return ok(res, 'Commission', { items: await prisma.bookingCommission.findMany({ where: { transporterId: id }, orderBy: { computedAt: 'desc' }, take: 200, include: { rule: { select: { name: true, version: true } } } }) });
    case 'performance': {
      const [offers, accepted, delivered, delayed] = await Promise.all([
        prisma.transporterOffer.count({ where: { transporterId: id } }),
        prisma.transporterOffer.count({ where: { transporterId: id, status: 'ACCEPTED' } }),
        prisma.trip.count({ where: { transporterId: id, status: { in: ['DELIVERED', 'COMPLETED'] } } }),
        prisma.tripAlert.count({ where: { type: 'DELAYED_DELIVERY', tripId: { in: (await prisma.trip.findMany({ where: { transporterId: id }, select: { id: true } })).map((x) => x.id) } } }),
      ]);
      return ok(res, 'Performance', { offers, accepted, winRate: offers ? Math.round((accepted / offers) * 1000) / 10 : 0, delivered, delayed, onTimeRate: delivered ? Math.round(((delivered - delayed) / delivered) * 1000) / 10 : null });
    }
    case 'activity':
      return ok(res, 'Activity', { items: await activityFor('transporter', id) });
    case 'notes':
      return ok(res, 'Notes', { items: await notesFor('TRANSPORTER', id) });
    default:
      throw AppError.notFound('Unknown tab');
  }
});

adminTransportersRouter.put('/:id', can('transporters', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  await assertInScope(req, 'TRANSPORTER', id);
  const input = body(
    req,
    z.object({ companyName: z.string().trim().min(2).max(160).optional(), address: z.string().trim().min(5).max(300).optional(), city: z.string().trim().min(2).max(80).optional(), state: z.string().trim().min(2).max(80).optional(), pincode: pincodeSchema.optional(), category: z.string().trim().max(40).nullable().optional(), serviceStates: z.array(z.string()).max(36).optional() }).strict(),
  );
  const before = await prisma.agency.findUnique({ where: { id } });
  if (!before) throw AppError.notFound('Transporter not found');
  const t = await prisma.$transaction(async (tx) => {
    const u = await tx.agency.update({ where: { id }, data: input });
    await audit({ action: 'transporter.updated_by_admin', entityType: 'transporter', entityId: id, module: 'transporters', previousValue: Object.fromEntries(Object.keys(input).map((k) => [k, (before as Record<string, unknown>)[k] ?? null])) as Prisma.InputJsonValue, newValue: input as Prisma.InputJsonValue, req }, tx);
    return u;
  });
  ok(res, 'Transporter updated', { transporter: t });
});

adminTransportersRouter.post('/:id/review', async (req: Request, res: Response) => {
  const id = idOf(req);
  const { action, reason } = body(req, reviewSchema);
  const perm = action === 'REJECT' ? 'reject' : action === 'APPROVE' ? 'approve' : 'edit';
  await new Promise<void>((resolve, reject) => can('transporters', perm)(req, res, (e?: unknown) => (e ? reject(e) : resolve())));
  await assertInScope(req, 'TRANSPORTER', id);
  if (action === 'REJECT' && (!reason || reason.length < 5)) throw AppError.badRequest('A rejection reason is required', ErrorCode.VALIDATION_ERROR, [{ field: 'reason', message: 'Explain why' }]);
  const t = await prisma.agency.findUnique({ where: { id } });
  if (!t) throw AppError.notFound('Transporter not found');
  if (t.verificationStatus === 'SUSPENDED') throw AppError.conflict('Reactivate the transporter first', ErrorCode.INVALID_STATE_TRANSITION);
  const to = action === 'START_REVIEW' ? 'UNDER_REVIEW' : action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  if (t.verificationStatus === to) throw AppError.conflict(`Already ${to.toLowerCase()}`, ErrorCode.INVALID_STATE_TRANSITION);
  let verificationNotice: unknown = null;
  await prisma.$transaction(async (tx) => {
    await tx.agency.update({ where: { id }, data: { verificationStatus: to, rejectionReason: to === 'REJECTED' ? reason : null, verifiedAt: to === 'APPROVED' ? new Date() : t.verifiedAt, verifiedById: to === 'APPROVED' ? req.admin!.userId : t.verifiedById } });
    await recordReview(tx, { entityType: 'TRANSPORTER', entityId: id, fromStatus: t.verificationStatus, toStatus: to, reason, reviewerId: req.admin!.userId });
    verificationNotice = to;
    await audit({ action: `transporter.${to.toLowerCase()}`, entityType: 'transporter', entityId: id, module: 'transporters', previousValue: { status: t.verificationStatus }, newValue: { status: to, reason: reason ?? null }, req }, tx);
  });
  if (verificationNotice) await notifyTransporter(id, { type: 'TRANSPORTER_VERIFICATION_UPDATE', title: `Verification update: ${String(verificationNotice).replace(/_/g, ' ').toLowerCase()}`, message: reason ? String(reason) : 'Your transporter verification status has changed.', link: '/transporter/profile' });
  ok(res, `Transporter ${to.replace('_', ' ').toLowerCase()}`, { status: to });
});

adminTransportersRouter.post('/:id/suspend', can('transporters', 'approve'), async (req: Request, res: Response) => {
  const id = idOf(req);
  await assertInScope(req, 'TRANSPORTER', id);
  const { reason } = body(req, z.object({ reason: z.string().trim().min(5, 'Give a reason').max(500) }));
  const t = await prisma.agency.findUnique({ where: { id }, include: { members: true } });
  if (!t) throw AppError.notFound('Transporter not found');
  if (t.verificationStatus === 'SUSPENDED') throw AppError.conflict('Already suspended');
  await prisma.$transaction(async (tx) => {
    await tx.agency.update({ where: { id }, data: { verificationStatus: 'SUSPENDED', statusBeforeSuspension: t.verificationStatus, suspensionReason: reason } });
    await tx.refreshSession.updateMany({ where: { userId: { in: t.members.map((m) => m.userId) }, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'TRANSPORTER_SUSPENDED' } });
    await recordReview(tx, { entityType: 'TRANSPORTER', entityId: id, fromStatus: t.verificationStatus, toStatus: 'SUSPENDED', reason, reviewerId: req.admin!.userId });
    await audit({ action: 'transporter.suspended', entityType: 'transporter', entityId: id, module: 'transporters', previousValue: { status: t.verificationStatus }, newValue: { status: 'SUSPENDED', reason }, req }, tx);
  });
  ok(res, 'Transporter suspended. It will not receive new booking requests.', null);
});

adminTransportersRouter.post('/:id/reactivate', can('transporters', 'approve'), async (req: Request, res: Response) => {
  const id = idOf(req);
  await assertInScope(req, 'TRANSPORTER', id);
  const t = await prisma.agency.findUnique({ where: { id } });
  if (!t) throw AppError.notFound('Transporter not found');
  if (t.verificationStatus !== 'SUSPENDED') throw AppError.conflict('Transporter is not suspended');
  const to = t.statusBeforeSuspension ?? 'PENDING_VERIFICATION';
  await prisma.$transaction(async (tx) => {
    await tx.agency.update({ where: { id }, data: { verificationStatus: to, statusBeforeSuspension: null, suspensionReason: null } });
    await recordReview(tx, { entityType: 'TRANSPORTER', entityId: id, fromStatus: 'SUSPENDED', toStatus: to, reason: 'Reactivated', reviewerId: req.admin!.userId });
    await audit({ action: 'transporter.reactivated', entityType: 'transporter', entityId: id, module: 'transporters', newValue: { status: to }, req }, tx);
  });
  ok(res, 'Transporter reactivated', { status: to });
});

adminTransportersRouter.post('/:id/assign', can('transporters', 'assign'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const { employeeId } = body(req, z.object({ employeeId: z.string().uuid().nullable() }));
  if (!(await prisma.agency.findUnique({ where: { id }, select: { id: true } }))) throw AppError.notFound('Transporter not found');
  await assignEntity(req, 'TRANSPORTER', id, employeeId);
  ok(res, employeeId ? 'Employee assigned' : 'Assignment removed', null);
});

adminTransportersRouter.post('/:id/notes', can('transporters', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  await assertInScope(req, 'TRANSPORTER', id);
  const { note } = body(req, z.object({ note: z.string().trim().min(2).max(2000) }));
  created(res, 'Note added', { note: await addNote(req, 'TRANSPORTER', id, note) });
});

export { companyCreateSchema, transporterCreateSchema };
