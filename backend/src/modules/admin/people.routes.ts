import type { Prisma } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ADMIN_MODULES, adminPermissionKey, type AdminAction, type AdminModule } from '../../config/admin-permissions';
import { prisma } from '../../lib/prisma';
import { AppError, ErrorCode } from '../../utils/errors';
import { created, ok } from '../../utils/response';
import { emailSchema, fullNameSchema, phoneSchema } from '../../utils/validators';
import { audit } from '../audit/audit';
import { nextCodeRaw } from './codes';
import { adminAuth, body, can, dateRange, hasPermission, idOf, insensitive, orderBy, parseList, respondList, win, type Column } from './core';
import { companyCreateSchema, createCompanyOnBehalf, createTransporterOnBehalf, transporterCreateSchema } from './parties.routes';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((s) => new Date(`${s}T00:00:00Z`));

// ===========================================================================
// Roles & permission matrix
// ===========================================================================

export const adminRolesRouter = Router();
adminRolesRouter.use(...adminAuth);

adminRolesRouter.get('/matrix', can('roles', 'view'), (_req: Request, res: Response) => {
  ok(res, 'Permission matrix', { modules: Object.entries(ADMIN_MODULES).map(([key, m]) => ({ key, label: m.label, actions: m.actions })) });
});

adminRolesRouter.get('/', can('roles', 'view'), async (_req: Request, res: Response) => {
  const roles = await prisma.employeeRole.findMany({
    orderBy: { name: 'asc' },
    include: { permissions: { include: { permission: { select: { key: true } } } }, _count: { select: { employees: true } } },
  });
  ok(res, 'Roles', { roles: roles.map((r) => ({ ...r, permissions: r.permissions.map((p) => p.permission.key).sort(), employees: r._count.employees })) });
});

const validKeys = new Set(Object.entries(ADMIN_MODULES).flatMap(([m, d]) => d.actions.map((a) => adminPermissionKey(m as AdminModule, a as AdminAction))));
const roleSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{2,39}$/, 'Use letters, digits and underscores').optional(),
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(300).optional(),
  dataScope: z.enum(['ALL', 'ASSIGNED']),
  isActive: z.boolean().default(true),
  permissions: z.array(z.string()).max(300).refine((keys) => keys.every((k) => validKeys.has(k)), 'Unknown permission'),
});

/** Employees who may edit roles can never grant permissions they do not hold themselves. */
function assertNoEscalation(req: Request, keys: string[]) {
  if (req.admin!.isSuper) return;
  const mine = new Set(req.auth!.principal.permissions);
  const extra = keys.filter((k) => !mine.has(k));
  if (extra.length) throw AppError.forbidden(`You cannot grant permissions you do not have: ${extra.slice(0, 5).join(', ')}`);
}

async function permissionIds(keys: string[]) {
  const rows = await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
  return rows.map((r) => r.id);
}

adminRolesRouter.post('/', can('roles', 'create'), async (req: Request, res: Response) => {
  const input = body(req, roleSchema.required({ code: true }));
  assertNoEscalation(req, input.permissions);
  if (await prisma.employeeRole.findUnique({ where: { code: input.code } })) throw AppError.conflict('A role with this code already exists');
  const ids = await permissionIds(input.permissions);
  const role = await prisma.$transaction(async (tx) => {
    const r = await tx.employeeRole.create({ data: { code: input.code, name: input.name, description: input.description, dataScope: input.dataScope, isActive: input.isActive, permissions: { create: ids.map((permissionId) => ({ permissionId })) } } });
    await audit({ action: 'role.created', entityType: 'employee_role', entityId: r.id, module: 'roles', newValue: { code: r.code, permissions: input.permissions, dataScope: input.dataScope }, req }, tx);
    return r;
  });
  created(res, 'Role created', { role });
});

adminRolesRouter.put('/:id', can('roles', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const input = body(req, roleSchema.omit({ code: true }));
  assertNoEscalation(req, input.permissions);
  const role = await prisma.employeeRole.findUnique({ where: { id }, include: { permissions: { include: { permission: { select: { key: true } } } } } });
  if (!role) throw AppError.notFound('Role not found');
  const before = role.permissions.map((p) => p.permission.key).sort();
  const ids = await permissionIds(input.permissions);
  await prisma.$transaction(async (tx) => {
    await tx.employeeRole.update({ where: { id }, data: { name: input.name, description: input.description, dataScope: input.dataScope, isActive: input.isActive } });
    await tx.employeeRolePermission.deleteMany({ where: { roleId: id } });
    await tx.employeeRolePermission.createMany({ data: ids.map((permissionId) => ({ roleId: id, permissionId })) });
    await audit({
      action: 'role.permissions_changed',
      entityType: 'employee_role',
      entityId: id,
      module: 'roles',
      previousValue: { permissions: before, dataScope: role.dataScope, isActive: role.isActive },
      newValue: { permissions: [...input.permissions].sort(), dataScope: input.dataScope, isActive: input.isActive },
      req,
    }, tx);
  });
  ok(res, 'Role updated. Changes apply on the employees’ next request.', null);
});

adminRolesRouter.delete('/:id', can('roles', 'delete'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const role = await prisma.employeeRole.findUnique({ where: { id }, include: { _count: { select: { employees: true } } } });
  if (!role) throw AppError.notFound('Role not found');
  if (role.isSystem) throw AppError.badRequest('Built-in roles cannot be deleted; deactivate it instead');
  if (role._count.employees) throw AppError.conflict('Move the employees to another role first');
  await prisma.employeeRole.delete({ where: { id } });
  await audit({ action: 'role.deleted', entityType: 'employee_role', entityId: id, module: 'roles', previousValue: { code: role.code }, req });
  ok(res, 'Role deleted', null);
});

// ===========================================================================
// Employees
// ===========================================================================

export const adminEmployeesRouter = Router();
adminEmployeesRouter.use(...adminAuth);

const employeeColumns: Column[] = [
  { key: 'employeeCode', label: 'Employee ID', format: 'text' },
  { key: 'name', label: 'Employee name', format: 'text' },
  { key: 'phone', label: 'Mobile', format: 'text' },
  { key: 'email', label: 'Email', format: 'text' },
  { key: 'designation', label: 'Designation', format: 'text' },
  { key: 'department', label: 'Department', format: 'text' },
  { key: 'role', label: 'Role', format: 'text' },
  { key: 'manager', label: 'Reporting manager', format: 'text' },
  { key: 'joiningDate', label: 'Joining date', format: 'date' },
  { key: 'employmentStatus', label: 'Employment status', format: 'text' },
  { key: 'loginStatus', label: 'Login status', format: 'text' },
];

adminEmployeesRouter.get('/', can('employees', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { roleId: z.string().uuid().optional(), status: z.string().optional(), department: z.string().optional() });
  const where: Prisma.EmployeeWhereInput = {
    ...(q.roleId ? { roleId: q.roleId as string } : {}),
    ...(q.status ? { employmentStatus: q.status as never } : {}),
    ...(q.department ? { department: insensitive(q.department as string) } : {}),
    ...(q.q ? { OR: [{ employeeCode: insensitive(q.q) }, { user: { fullName: insensitive(q.q) } }, { user: { phone: { contains: q.q } } }, { user: { email: insensitive(q.q) } }] } : {}),
  };
  const load = async (paged: boolean) => {
    const rows = await prisma.employee.findMany({
      where,
      orderBy: orderBy(q, ['createdAt', 'employeeCode', 'joiningDate'], 'createdAt'),
      ...win(q, paged),
      include: { user: { select: { fullName: true, phone: true, email: true, lastLoginAt: true, passwordHash: true, lockedUntil: true } }, role: { select: { id: true, name: true } }, reportingManager: { select: { user: { select: { fullName: true } } } } },
    });
    return rows.map((e) => ({
      id: e.id,
      employeeCode: e.employeeCode,
      name: e.user.fullName,
      phone: e.user.phone,
      email: e.user.email,
      designation: e.designation,
      department: e.department,
      role: e.role.name,
      roleId: e.role.id,
      manager: e.reportingManager?.user.fullName ?? null,
      joiningDate: e.joiningDate,
      employmentStatus: e.employmentStatus,
      loginStatus: !e.loginEnabled ? 'DISABLED' : !e.user.passwordHash ? 'NOT_ACTIVATED' : e.user.lockedUntil && e.user.lockedUntil > new Date() ? 'LOCKED' : 'ENABLED',
      lastLoginAt: e.user.lastLoginAt,
    }));
  };
  const [total, rows] = await Promise.all([prisma.employee.count({ where }), load(true)]);
  await respondList(req, res, { title: 'Employees', q, columns: employeeColumns, total, rows, exportRows: () => load(false), module: 'employees' });
});

const employeeSchema = z.object({
  fullName: fullNameSchema,
  phone: phoneSchema,
  email: emailSchema,
  designation: z.string().trim().min(2).max(80),
  department: z.string().trim().min(2).max(80),
  roleId: z.string().uuid(),
  reportingManagerId: z.string().uuid().nullable().optional(),
  joiningDate: dateOnly,
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).optional(),
  branch: z.string().trim().max(80).optional(),
  territory: z.string().trim().max(80).optional(),
});

adminEmployeesRouter.post('/', can('employees', 'create'), async (req: Request, res: Response) => {
  const input = body(req, employeeSchema);
  const role = await prisma.employeeRole.findUnique({ where: { id: input.roleId }, include: { permissions: { include: { permission: { select: { key: true } } } } } });
  if (!role || !role.isActive) throw AppError.badRequest('Select an active role');
  assertNoEscalation(req, role.permissions.map((p) => p.permission.key));
  const dup = await prisma.user.findFirst({ where: { OR: [{ phone: input.phone }, { email: input.email }] }, select: { id: true } });
  if (dup) throw AppError.conflict('A user with this mobile number or email already exists', ErrorCode.PHONE_ALREADY_REGISTERED);
  const sysRole = await prisma.role.findUniqueOrThrow({ where: { name: 'EMPLOYEE' } });
  const emp = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { fullName: input.fullName, phone: input.phone, email: input.email, accountStatus: 'ACTIVE', isEmailVerified: false, roles: { create: { roleId: sysRole.id } } } });
    const e = await tx.employee.create({
      data: {
        employeeCode: await nextCodeRaw(tx, 'employee_code_seq', 'EMP', 4),
        userId: user.id,
        roleId: input.roleId,
        designation: input.designation,
        department: input.department,
        reportingManagerId: input.reportingManagerId ?? null,
        joiningDate: input.joiningDate,
        employmentType: input.employmentType,
        branch: input.branch,
        territory: input.territory,
        createdById: req.admin!.userId,
      },
    });
    await audit({ action: 'employee.created', entityType: 'employee', entityId: e.id, module: 'employees', newValue: { employeeCode: e.employeeCode, role: role.code, email: input.email }, req }, tx);
    return e;
  });
  created(res, `Employee ${emp.employeeCode} created. They activate access with "Forgot password" on the admin login (code sent to ${input.email}).`, { employee: emp });
});

async function employeeOr404(id: string) {
  const e = await prisma.employee.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, fullName: true, phone: true, email: true, lastLoginAt: true, passwordHash: true, lockedUntil: true, accountStatus: true } },
      role: { include: { permissions: { include: { permission: { select: { key: true } } } } } },
      reportingManager: { select: { id: true, user: { select: { fullName: true } } } },
      permissionOverrides: { include: { permission: { select: { key: true } } } },
    },
  });
  if (!e) throw AppError.notFound('Employee not found');
  return e;
}

adminEmployeesRouter.get('/:id', async (req: Request, res: Response) => {
  const id = idOf(req);
  // Employees may always view their own record; others need employees.view.
  const isSelf = req.admin!.employeeId === id;
  if (!isSelf && !hasPermission(req, 'employees', 'view')) throw AppError.forbidden();
  const e = await employeeOr404(id);
  const roleKeys = e.role.permissions.map((p) => p.permission.key);
  const grants = e.permissionOverrides.filter((o) => o.effect === 'GRANT').map((o) => o.permission.key);
  const denies = e.permissionOverrides.filter((o) => o.effect === 'DENY').map((o) => o.permission.key);
  const effective = [...new Set([...roleKeys, ...grants])].filter((k) => !denies.includes(k)).sort();
  const [assignments, loginHistory, sessions, activity, leads, tasks] = await Promise.all([
    prisma.employeeAssignment.findMany({ where: { employeeId: id, endedAt: null }, orderBy: { assignedAt: 'desc' } }),
    prisma.loginAudit.findMany({ where: { userId: e.userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.refreshSession.findMany({ where: { userId: e.userId, revokedAt: null, expiresAt: { gt: new Date() } }, select: { familyId: true, deviceInfo: true, ipAddress: true, userAgent: true, createdAt: true, expiresAt: true } }),
    prisma.auditLog.findMany({ where: { actorUserId: e.userId }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, action: true, module: true, entityType: true, entityId: true, createdAt: true, ipAddress: true } }),
    prisma.lead.groupBy({ by: ['status'], where: { assignedEmployeeId: id }, _count: { _all: true } }),
    prisma.employeeTask.findMany({ where: { assigneeId: id }, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }], take: 50 }),
  ]);
  const companies = await prisma.company.findMany({ where: { id: { in: assignments.filter((a) => a.entityType === 'COMPANY').map((a) => a.entityId) } }, select: { id: true, companyCode: true, name: true, status: true } });
  const transporters = await prisma.agency.findMany({ where: { id: { in: assignments.filter((a) => a.entityType === 'TRANSPORTER').map((a) => a.entityId) } }, select: { id: true, companyName: true, verificationStatus: true } });
  const { passwordHash, ...user } = e.user;
  ok(res, 'Employee', {
    employee: { ...e, user: { ...user, loginActivated: Boolean(passwordHash) }, role: { id: e.role.id, code: e.role.code, name: e.role.name, dataScope: e.role.dataScope }, permissionOverrides: e.permissionOverrides.map((o) => ({ key: o.permission.key, effect: o.effect })) },
    permissions: { role: roleKeys.sort(), effective },
    assignments: { companies, transporters },
    leadsByStatus: Object.fromEntries(leads.map((l) => [l.status, l._count._all])),
    tasks,
    loginHistory,
    sessions,
    activity,
  });
});

adminEmployeesRouter.put('/:id', can('employees', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const input = body(req, employeeSchema.omit({ phone: true, email: true }).extend({ employmentStatus: z.enum(['ACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED']).optional() }).partial().strict());
  const e = await employeeOr404(id);
  if (input.reportingManagerId === id) throw AppError.badRequest('An employee cannot report to themselves');
  if (input.roleId && input.roleId !== e.roleId) {
    const role = await prisma.employeeRole.findUnique({ where: { id: input.roleId }, include: { permissions: { include: { permission: { select: { key: true } } } } } });
    if (!role || !role.isActive) throw AppError.badRequest('Select an active role');
    assertNoEscalation(req, role.permissions.map((p) => p.permission.key));
  }
  const { fullName, ...data } = input;
  await prisma.$transaction(async (tx) => {
    if (fullName) await tx.user.update({ where: { id: e.userId }, data: { fullName } });
    await tx.employee.update({ where: { id }, data });
    if (data.employmentStatus && ['RESIGNED', 'TERMINATED'].includes(data.employmentStatus)) {
      await tx.refreshSession.updateMany({ where: { userId: e.userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'EMPLOYMENT_ENDED' } });
    }
    await audit({ action: input.roleId && input.roleId !== e.roleId ? 'employee.role_changed' : 'employee.updated', entityType: 'employee', entityId: id, module: 'employees', previousValue: { roleId: e.roleId, designation: e.designation, department: e.department, employmentStatus: e.employmentStatus }, newValue: input as Prisma.InputJsonValue, req }, tx);
  });
  ok(res, 'Employee updated', null);
});

adminEmployeesRouter.post('/:id/login-status', can('employees', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const { enabled, reason } = body(req, z.object({ enabled: z.boolean(), reason: z.string().trim().max(300).optional() }));
  const e = await employeeOr404(id);
  if (e.userId === req.admin!.userId) throw AppError.badRequest('You cannot change your own login access');
  await prisma.$transaction(async (tx) => {
    await tx.employee.update({ where: { id }, data: { loginEnabled: enabled } });
    if (!enabled) await tx.refreshSession.updateMany({ where: { userId: e.userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'ACCESS_DISABLED' } });
    await audit({ action: enabled ? 'employee.activated' : 'employee.deactivated', entityType: 'employee', entityId: id, module: 'employees', previousValue: { loginEnabled: e.loginEnabled }, newValue: { loginEnabled: enabled, reason: reason ?? null }, req }, tx);
  });
  ok(res, enabled ? 'Login access enabled' : 'Login access disabled and sessions ended', null);
});

/** Ends every session, unlocks the account and clears the password; the employee re-activates via "Forgot password". */
adminEmployeesRouter.post('/:id/reset-access', can('employees', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const e = await employeeOr404(id);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: e.userId }, data: { passwordHash: null, failedLoginAttempts: 0, lockedUntil: null } });
    const r = await tx.refreshSession.updateMany({ where: { userId: e.userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'ACCESS_RESET' } });
    await audit({ action: 'employee.access_reset', entityType: 'employee', entityId: id, module: 'employees', metadata: { sessionsEnded: r.count }, req }, tx);
  });
  ok(res, 'Access reset. The employee must set a new password using "Forgot password".', null);
});

adminEmployeesRouter.delete('/:id/sessions/:sessionId', can('employees', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const e = await employeeOr404(id);
  const familyId = z.string().uuid().parse(req.params.sessionId);
  const r = await prisma.refreshSession.updateMany({ where: { userId: e.userId, familyId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'ADMIN_REVOKED' } });
  await audit({ action: 'employee.session_revoked', entityType: 'employee', entityId: id, module: 'employees', metadata: { familyId }, req });
  ok(res, r.count ? 'Session ended' : 'Session already ended', null);
});

adminEmployeesRouter.put('/:id/permissions', can('roles', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const { overrides } = body(req, z.object({ overrides: z.array(z.object({ key: z.string().refine((k) => validKeys.has(k), 'Unknown permission'), effect: z.enum(['GRANT', 'DENY']) })).max(300) }));
  assertNoEscalation(req, overrides.filter((o) => o.effect === 'GRANT').map((o) => o.key));
  const e = await employeeOr404(id);
  const perms = new Map((await prisma.permission.findMany({ where: { key: { in: overrides.map((o) => o.key) } } })).map((p) => [p.key, p.id]));
  await prisma.$transaction(async (tx) => {
    await tx.employeePermissionOverride.deleteMany({ where: { employeeId: id } });
    await tx.employeePermissionOverride.createMany({ data: overrides.map((o) => ({ employeeId: id, permissionId: perms.get(o.key)!, effect: o.effect })) });
    await audit({ action: 'employee.permissions_changed', entityType: 'employee', entityId: id, module: 'roles', previousValue: e.permissionOverrides.map((o) => ({ key: o.permission.key, effect: o.effect })), newValue: overrides, req }, tx);
  });
  ok(res, 'Permission overrides saved', null);
});

/** Bulk-assign companies or transporters to an employee (keeps assignment history). */
adminEmployeesRouter.post('/:id/assignments', async (req: Request, res: Response) => {
  const id = idOf(req);
  const { entityType, entityIds } = body(req, z.object({ entityType: z.enum(['COMPANY', 'TRANSPORTER']), entityIds: z.array(z.string().uuid()).min(1).max(200) }));
  if (!hasPermission(req, entityType === 'COMPANY' ? 'companies' : 'transporters', 'assign')) throw AppError.forbidden();
  const e = await employeeOr404(id);
  if (e.employmentStatus !== 'ACTIVE') throw AppError.badRequest('Assign work only to active employees');
  await prisma.$transaction(async (tx) => {
    await tx.employeeAssignment.updateMany({ where: { entityType, entityId: { in: entityIds }, endedAt: null, employeeId: { not: id } }, data: { endedAt: new Date() } });
    const already = new Set((await tx.employeeAssignment.findMany({ where: { entityType, entityId: { in: entityIds }, endedAt: null, employeeId: id } })).map((a) => a.entityId));
    await tx.employeeAssignment.createMany({ data: entityIds.filter((x) => !already.has(x)).map((entityId) => ({ entityType, entityId, employeeId: id, assignedById: req.admin!.userId })) });
    await audit({ action: 'employee.portfolio_assigned', entityType: 'employee', entityId: id, module: 'employees', newValue: { entityType, entityIds }, req }, tx);
  });
  ok(res, `${entityIds.length} ${entityType.toLowerCase()}(s) assigned`, null);
});

// ===========================================================================
// Leads (CRM), follow-ups, tasks
// ===========================================================================

export const adminLeadsRouter = Router();
adminLeadsRouter.use(...adminAuth);

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP', 'REGISTRATION_PENDING', 'REGISTERED', 'VERIFIED', 'ACTIVE', 'NOT_INTERESTED', 'LOST'] as const;
export const LEAD_SOURCES = ['WEBSITE', 'REFERRAL', 'FIELD_VISIT', 'COLD_CALL', 'EXHIBITION', 'SOCIAL_MEDIA', 'PARTNER', 'INBOUND_CALL', 'OTHER'] as const;
const normName = (s: string) => s.toLowerCase().replace(/\b(pvt|private|ltd|limited|llp|co|company|the|and|&)\b/g, '').replace(/[^a-z0-9]/g, '');

const leadColumns: Column[] = [
  { key: 'leadCode', label: 'Lead ID', format: 'text' },
  { key: 'leadType', label: 'Type', format: 'text' },
  { key: 'name', label: 'Business / person', format: 'text' },
  { key: 'contactPerson', label: 'Contact person', format: 'text' },
  { key: 'phone', label: 'Mobile', format: 'text' },
  { key: 'email', label: 'Email', format: 'text' },
  { key: 'city', label: 'City', format: 'text' },
  { key: 'state', label: 'State', format: 'text' },
  { key: 'source', label: 'Source', format: 'text' },
  { key: 'owner', label: 'Assigned employee', format: 'text' },
  { key: 'status', label: 'Status', format: 'text' },
  { key: 'nextFollowUpAt', label: 'Next follow-up', format: 'datetime' },
  { key: 'remarks', label: 'Remarks', format: 'text' },
];

/** ASSIGNED-scope employees only see leads they own. */
function leadScope(req: Request): Prisma.LeadWhereInput {
  return req.admin!.scope === 'ASSIGNED' ? { assignedEmployeeId: req.admin!.employeeId } : {};
}

async function leadOr404(req: Request) {
  const lead = await prisma.lead.findFirst({ where: { id: idOf(req), ...leadScope(req) } });
  if (!lead) throw AppError.notFound('Lead not found');
  return lead;
}

/** Keeps lead status in step with the registered account (Registered -> Verified -> Active). */
export async function syncConvertedStatus(lead: { id: string; status: string; convertedEntityType: string | null; convertedEntityId: string | null }) {
  if (!lead.convertedEntityId || ['NOT_INTERESTED', 'LOST'].includes(lead.status)) return lead.status;
  let next = lead.status;
  if (lead.convertedEntityType === 'COMPANY') {
    const c = await prisma.company.findUnique({ where: { id: lead.convertedEntityId }, select: { status: true, _count: { select: { bookings: true } } } });
    if (c) next = c._count.bookings > 0 ? 'ACTIVE' : c.status === 'VERIFIED' ? 'VERIFIED' : 'REGISTERED';
  } else if (lead.convertedEntityType === 'TRANSPORTER') {
    const t = await prisma.agency.findUnique({ where: { id: lead.convertedEntityId }, select: { verificationStatus: true, _count: { select: { offers: true } } } });
    if (t) next = t._count.offers > 0 ? 'ACTIVE' : t.verificationStatus === 'APPROVED' ? 'VERIFIED' : 'REGISTERED';
  } else if (lead.convertedEntityType === 'DRIVER') {
    const d = await prisma.driver.findUnique({ where: { id: lead.convertedEntityId }, select: { verificationStatus: true, _count: { select: { trips: true } } } });
    if (d) next = d._count.trips > 0 ? 'ACTIVE' : d.verificationStatus === 'APPROVED' ? 'VERIFIED' : 'REGISTERED';
  }
  if (next !== lead.status) {
    await prisma.$transaction([
      prisma.lead.update({ where: { id: lead.id }, data: { status: next } }),
      prisma.leadActivity.create({ data: { leadId: lead.id, type: 'STATUS_CHANGE', fromValue: lead.status, toValue: next, notes: 'Updated from the registered account' } }),
    ]);
  }
  return next;
}

adminLeadsRouter.get('/', can('leads', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { type: z.string().optional(), status: z.string().optional(), source: z.string().optional(), employeeId: z.string().uuid().optional(), due: z.enum(['today', 'overdue']).optional(), city: z.string().optional() });
  const endToday = new Date(new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10) + 'T23:59:59.999+05:30');
  const where: Prisma.LeadWhereInput = {
    ...leadScope(req),
    ...(q.type ? { leadType: q.type as string } : {}),
    ...(q.status ? { status: q.status as string } : {}),
    ...(q.source ? { source: q.source as string } : {}),
    ...(q.employeeId ? { assignedEmployeeId: q.employeeId as string } : {}),
    ...(q.city ? { city: insensitive(q.city as string) } : {}),
    ...(q.due === 'today' ? { nextFollowUpAt: { lte: endToday } } : q.due === 'overdue' ? { nextFollowUpAt: { lt: new Date() } } : {}),
    ...(q.from || q.to ? { createdAt: dateRange(q) } : {}),
    ...(q.q ? { OR: [{ leadCode: insensitive(q.q) }, { name: insensitive(q.q) }, { contactPerson: insensitive(q.q) }, { phone: { contains: q.q } }, { email: insensitive(q.q) }] } : {}),
  };
  const load = async (paged: boolean) => {
    const rows = await prisma.lead.findMany({ where, orderBy: orderBy(q, ['createdAt', 'nextFollowUpAt', 'status', 'name'], 'createdAt'), ...win(q, paged), include: { owner: { select: { id: true, user: { select: { fullName: true } } } } } });
    return Promise.all(rows.map(async (l) => ({ ...l, status: await syncConvertedStatus(l), owner: l.owner?.user.fullName ?? null, ownerId: l.owner?.id ?? null })));
  };
  const [total, rows] = await Promise.all([prisma.lead.count({ where }), load(true)]);
  await respondList(req, res, { title: 'Leads', q, columns: leadColumns, total, rows, exportRows: () => load(false), module: 'leads' });
});

const leadSchema = z.object({
  leadType: z.enum(['COMPANY', 'TRANSPORTER', 'DRIVER']),
  name: z.string().trim().min(2).max(160),
  contactPerson: z.string().trim().max(120).optional(),
  phone: phoneSchema,
  email: emailSchema.optional().or(z.literal('').transform(() => undefined)),
  gstNumber: z.string().trim().toUpperCase().max(15).optional().or(z.literal('').transform(() => undefined)),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  source: z.enum(LEAD_SOURCES),
  nextFollowUpAt: z.coerce.date().optional(),
  remarks: z.string().trim().max(2000).optional(),
  assignedEmployeeId: z.string().uuid().nullable().optional(),
});

/** Duplicate detection on normalised mobile, GSTIN and business name + city. */
async function findDuplicate(input: { leadType: string; phone: string; gstNumber?: string; name: string; city?: string }, excludeId?: string) {
  const nn = normName(input.name);
  return prisma.lead.findFirst({
    where: {
      leadType: input.leadType,
      id: excludeId ? { not: excludeId } : undefined,
      OR: [{ phone: input.phone }, ...(input.gstNumber ? [{ gstNumber: input.gstNumber }] : []), ...(nn.length >= 4 && input.city ? [{ normalizedName: nn, city: { equals: input.city, mode: 'insensitive' as const } }] : [])],
    },
    select: { id: true, leadCode: true, name: true, owner: { select: { user: { select: { fullName: true } } } } },
  });
}

adminLeadsRouter.post('/', can('leads', 'create'), async (req: Request, res: Response) => {
  const input = body(req, leadSchema);
  const dup = await findDuplicate(input);
  if (dup) throw AppError.conflict(`Duplicate of ${dup.leadCode} (${dup.name}${dup.owner ? `, owned by ${dup.owner.user.fullName}` : ''})`, ErrorCode.CONFLICT);
  const owner = input.assignedEmployeeId !== undefined && hasPermission(req, 'leads', 'assign') ? input.assignedEmployeeId : req.admin!.employeeId;
  const lead = await prisma.$transaction(async (tx) => {
    const l = await tx.lead.create({
      data: { ...input, assignedEmployeeId: owner ?? null, normalizedName: normName(input.name), leadCode: await nextCodeRaw(tx, 'lead_code_seq', 'LD', 6), createdById: req.admin!.userId },
    });
    await tx.leadActivity.create({ data: { leadId: l.id, type: 'NOTE', notes: `Lead created from ${input.source.replace(/_/g, ' ').toLowerCase()}`, actorId: req.admin!.userId } });
    if (input.nextFollowUpAt) await tx.followUp.create({ data: { leadId: l.id, employeeId: owner ?? null, dueAt: input.nextFollowUpAt, notes: 'Initial follow-up' } });
    await audit({ action: 'lead.created', entityType: 'lead', entityId: l.id, module: 'leads', newValue: { leadCode: l.leadCode, type: l.leadType }, req }, tx);
    return l;
  });
  created(res, `Lead ${lead.leadCode} created`, { lead });
});

adminLeadsRouter.get('/report/employees', can('leads', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req);
  const range = dateRange(q);
  const leads = await prisma.lead.findMany({ where: { ...leadScope(req), ...(range ? { createdAt: range } : {}) }, select: { assignedEmployeeId: true, status: true, convertedAt: true, source: true } });
  const emps = await prisma.employee.findMany({ select: { id: true, employeeCode: true, user: { select: { fullName: true } } } });
  const calls = await prisma.leadActivity.groupBy({ by: ['actorId', 'type'], where: { type: { in: ['CALL', 'MEETING'] }, ...(range ? { createdAt: range } : {}) }, _count: { _all: true } });
  const rows = emps
    .map((e) => {
      const mine = leads.filter((l) => l.assignedEmployeeId === e.id);
      const userCalls = calls.filter((c) => c.actorId && emps.find((x) => x.id === e.id));
      void userCalls;
      return {
        employee: e.user.fullName,
        employeeCode: e.employeeCode,
        assigned: mine.length,
        open: mine.filter((l) => !['REGISTERED', 'VERIFIED', 'ACTIVE', 'NOT_INTERESTED', 'LOST'].includes(l.status)).length,
        converted: mine.filter((l) => l.convertedAt).length,
        lost: mine.filter((l) => ['NOT_INTERESTED', 'LOST'].includes(l.status)).length,
        conversionRate: mine.length ? Math.round((mine.filter((l) => l.convertedAt).length / mine.length) * 1000) / 10 : 0,
      };
    })
    .filter((r) => r.assigned > 0);
  const bySource = Object.entries(leads.reduce<Record<string, { total: number; converted: number }>>((m, l) => ((m[l.source] ??= { total: 0, converted: 0 }), m[l.source].total++, l.convertedAt && m[l.source].converted++, m), {})).map(([source, v]) => ({ source, ...v }));
  ok(res, 'Employee-wise lead report', { employees: rows, sources: bySource });
});

adminLeadsRouter.get('/:id', can('leads', 'view'), async (req: Request, res: Response) => {
  const lead = await leadOr404(req);
  await syncConvertedStatus(lead);
  const full = await prisma.lead.findUniqueOrThrow({
    where: { id: lead.id },
    include: { owner: { select: { id: true, employeeCode: true, user: { select: { fullName: true } } } }, activities: { orderBy: { createdAt: 'desc' } }, followUps: { orderBy: { dueAt: 'desc' } } },
  });
  const actors = new Map((await prisma.user.findMany({ where: { id: { in: full.activities.map((a) => a.actorId!).filter(Boolean) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  ok(res, 'Lead', { lead: { ...full, activities: full.activities.map((a) => ({ ...a, actor: a.actorId ? actors.get(a.actorId) ?? 'Unknown' : 'System' })) } });
});

adminLeadsRouter.put('/:id', can('leads', 'edit'), async (req: Request, res: Response) => {
  const lead = await leadOr404(req);
  const input = body(req, leadSchema.omit({ assignedEmployeeId: true, leadType: true }).partial().extend({ status: z.enum(LEAD_STATUSES).optional() }).strict());
  if (input.phone || input.name || input.gstNumber) {
    const dup = await findDuplicate({ leadType: lead.leadType, phone: input.phone ?? lead.phone, gstNumber: input.gstNumber ?? lead.gstNumber ?? undefined, name: input.name ?? lead.name, city: input.city ?? lead.city ?? undefined }, lead.id);
    if (dup) throw AppError.conflict(`Duplicate of ${dup.leadCode} (${dup.name})`);
  }
  if (input.status && ['REGISTERED', 'VERIFIED', 'ACTIVE'].includes(input.status) && !lead.convertedEntityId) throw AppError.badRequest('Use "Convert to registration" to mark a lead registered');
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: lead.id }, data: { ...input, ...(input.name ? { normalizedName: normName(input.name) } : {}) } });
    if (input.status && input.status !== lead.status) await tx.leadActivity.create({ data: { leadId: lead.id, type: 'STATUS_CHANGE', fromValue: lead.status, toValue: input.status, actorId: req.admin!.userId } });
    await audit({ action: 'lead.updated', entityType: 'lead', entityId: lead.id, module: 'leads', previousValue: { status: lead.status, nextFollowUpAt: lead.nextFollowUpAt }, newValue: input as Prisma.InputJsonValue, req }, tx);
  });
  ok(res, 'Lead updated', null);
});

/** Assign / transfer: ownership history is kept in the activity log. */
adminLeadsRouter.post('/:id/assign', can('leads', 'assign'), async (req: Request, res: Response) => {
  const lead = await leadOr404(req);
  const { employeeId, reason } = body(req, z.object({ employeeId: z.string().uuid(), reason: z.string().trim().max(300).optional() }));
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, include: { user: { select: { fullName: true } } } });
  if (!emp || emp.employmentStatus !== 'ACTIVE') throw AppError.badRequest('Select an active employee');
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: lead.id }, data: { assignedEmployeeId: employeeId } });
    await tx.followUp.updateMany({ where: { leadId: lead.id, status: 'PENDING' }, data: { employeeId } });
    await tx.leadActivity.create({ data: { leadId: lead.id, type: lead.assignedEmployeeId ? 'TRANSFER' : 'ASSIGNMENT', fromValue: lead.assignedEmployeeId, toValue: employeeId, notes: reason ?? `Assigned to ${emp.user.fullName}`, actorId: req.admin!.userId } });
    await audit({ action: lead.assignedEmployeeId ? 'lead.transferred' : 'lead.assigned', entityType: 'lead', entityId: lead.id, module: 'leads', previousValue: { employeeId: lead.assignedEmployeeId }, newValue: { employeeId }, req }, tx);
  });
  ok(res, `Lead ${lead.assignedEmployeeId ? 'transferred' : 'assigned'} to ${emp.user.fullName}`, null);
});

adminLeadsRouter.post('/:id/activities', can('leads', 'edit'), async (req: Request, res: Response) => {
  const lead = await leadOr404(req);
  const input = body(req, z.object({ type: z.enum(['CALL', 'MEETING', 'NOTE']), connected: z.boolean().optional(), outcome: z.string().trim().max(120).optional(), notes: z.string().trim().max(2000).optional(), nextFollowUpAt: z.coerce.date().optional(), status: z.enum(LEAD_STATUSES).optional() }));
  await prisma.$transaction(async (tx) => {
    await tx.leadActivity.create({ data: { leadId: lead.id, type: input.type, connected: input.type === 'CALL' ? (input.connected ?? false) : null, outcome: input.outcome, notes: input.notes, actorId: req.admin!.userId } });
    const data: Prisma.LeadUpdateInput = {};
    if (input.nextFollowUpAt) {
      data.nextFollowUpAt = input.nextFollowUpAt;
      await tx.followUp.create({ data: { leadId: lead.id, employeeId: lead.assignedEmployeeId, dueAt: input.nextFollowUpAt, notes: input.outcome ?? input.notes } });
    }
    if (input.status && input.status !== lead.status && !['REGISTERED', 'VERIFIED', 'ACTIVE'].includes(input.status)) {
      data.status = input.status;
      await tx.leadActivity.create({ data: { leadId: lead.id, type: 'STATUS_CHANGE', fromValue: lead.status, toValue: input.status, actorId: req.admin!.userId } });
    } else if (lead.status === 'NEW') {
      data.status = 'CONTACTED';
      await tx.leadActivity.create({ data: { leadId: lead.id, type: 'STATUS_CHANGE', fromValue: 'NEW', toValue: 'CONTACTED', actorId: req.admin!.userId } });
    }
    if (Object.keys(data).length) await tx.lead.update({ where: { id: lead.id }, data });
  });
  created(res, `${input.type === 'CALL' ? 'Call' : input.type === 'MEETING' ? 'Meeting' : 'Note'} logged`, null);
});

adminLeadsRouter.post('/:id/follow-ups', can('leads', 'edit'), async (req: Request, res: Response) => {
  const lead = await leadOr404(req);
  const input = body(req, z.object({ dueAt: z.coerce.date(), notes: z.string().trim().max(1000).optional() }));
  const f = await prisma.$transaction(async (tx) => {
    const f = await tx.followUp.create({ data: { leadId: lead.id, employeeId: lead.assignedEmployeeId, dueAt: input.dueAt, notes: input.notes } });
    await tx.lead.update({ where: { id: lead.id }, data: { nextFollowUpAt: input.dueAt, status: ['NEW', 'CONTACTED', 'INTERESTED'].includes(lead.status) ? 'FOLLOW_UP' : lead.status } });
    await tx.leadActivity.create({ data: { leadId: lead.id, type: 'FOLLOW_UP', notes: `Follow-up scheduled${input.notes ? `: ${input.notes}` : ''}`, toValue: input.dueAt.toISOString(), actorId: req.admin!.userId } });
    return f;
  });
  created(res, 'Follow-up scheduled', { followUp: f });
});

/** Converts a lead into a real registration (company / transporter / driver) and links it. */
adminLeadsRouter.post('/:id/convert', can('leads', 'edit'), async (req: Request, res: Response) => {
  const lead = await leadOr404(req);
  if (lead.convertedEntityId) throw AppError.conflict('This lead is already converted');
  let entity: { id: string; label: string };
  if (lead.leadType === 'COMPANY') {
    if (!hasPermission(req, 'companies', 'create')) throw AppError.forbidden('You cannot register companies');
    const c = await createCompanyOnBehalf(req, body(req, companyCreateSchema));
    entity = { id: c.id, label: c.companyCode };
  } else if (lead.leadType === 'TRANSPORTER') {
    if (!hasPermission(req, 'transporters', 'create')) throw AppError.forbidden('You cannot register transporters');
    const t = await createTransporterOnBehalf(req, body(req, transporterCreateSchema));
    entity = { id: t.id, label: t.companyName };
  } else {
    throw AppError.badRequest('Register drivers from Driver Management (choose their transporter), then link the lead there.');
  }
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: lead.id }, data: { status: 'REGISTERED', convertedEntityType: lead.leadType, convertedEntityId: entity.id, convertedAt: new Date(), nextFollowUpAt: null } });
    await tx.followUp.updateMany({ where: { leadId: lead.id, status: 'PENDING' }, data: { status: 'DONE', outcome: 'Converted', completedAt: new Date() } });
    await tx.leadActivity.create({ data: { leadId: lead.id, type: 'CONVERSION', fromValue: lead.status, toValue: 'REGISTERED', notes: `Registered as ${entity.label}`, actorId: req.admin!.userId } });
    await audit({ action: 'lead.converted', entityType: 'lead', entityId: lead.id, module: 'leads', newValue: { entityType: lead.leadType, entityId: entity.id }, req }, tx);
  });
  created(res, `Lead converted: ${entity.label}`, { entityType: lead.leadType, entityId: entity.id });
});

adminLeadsRouter.delete('/:id', can('leads', 'delete'), async (req: Request, res: Response) => {
  const lead = await leadOr404(req);
  if (lead.convertedEntityId) throw AppError.conflict('Converted leads are kept for history');
  await prisma.lead.delete({ where: { id: lead.id } });
  await audit({ action: 'lead.deleted', entityType: 'lead', entityId: lead.id, module: 'leads', previousValue: { leadCode: lead.leadCode, name: lead.name }, req });
  ok(res, 'Lead deleted', null);
});

// ---- Follow-ups & tasks (personal work queue) -------------------------------------------

export const adminWorkRouter = Router();
adminWorkRouter.use(...adminAuth);

adminWorkRouter.get('/follow-ups', can('leads', 'view'), async (req: Request, res: Response) => {
  const mine = req.query.scope !== 'all' || !hasPermission(req, 'leads', 'assign');
  const items = await prisma.followUp.findMany({
    where: { status: 'PENDING', ...(mine ? { employeeId: req.admin!.employeeId ?? '00000000-0000-0000-0000-000000000000' } : {}) },
    orderBy: { dueAt: 'asc' },
    take: 200,
    include: { lead: { select: { id: true, leadCode: true, name: true, phone: true, status: true } }, employee: { select: { user: { select: { fullName: true } } } } },
  });
  ok(res, 'Follow-ups', { items: items.map((f) => ({ ...f, overdue: f.dueAt < new Date() })) });
});

adminWorkRouter.put('/follow-ups/:id', can('leads', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const input = body(req, z.object({ status: z.enum(['DONE', 'MISSED']), outcome: z.string().trim().max(300).optional() }));
  const f = await prisma.followUp.findUnique({ where: { id }, include: { lead: true } });
  if (!f || (req.admin!.scope === 'ASSIGNED' && f.lead.assignedEmployeeId !== req.admin!.employeeId)) throw AppError.notFound('Follow-up not found');
  await prisma.$transaction([
    prisma.followUp.update({ where: { id }, data: { status: input.status, outcome: input.outcome, completedAt: new Date() } }),
    prisma.leadActivity.create({ data: { leadId: f.leadId, type: 'FOLLOW_UP', notes: `Follow-up ${input.status === 'DONE' ? 'completed' : 'missed'}${input.outcome ? `: ${input.outcome}` : ''}`, actorId: req.admin!.userId } }),
  ]);
  ok(res, 'Follow-up updated', null);
});

adminWorkRouter.get('/tasks', can('tasks', 'view'), async (req: Request, res: Response) => {
  const all = req.query.scope === 'all' && hasPermission(req, 'tasks', 'assign');
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const items = await prisma.employeeTask.findMany({
    where: { ...(all ? {} : { assigneeId: req.admin!.employeeId ?? '00000000-0000-0000-0000-000000000000' }), ...(status ? { status } : {}) },
    orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
    take: 300,
    include: { assignee: { select: { id: true, employeeCode: true, user: { select: { fullName: true } } } } },
  });
  ok(res, 'Tasks', { items });
});

adminWorkRouter.post('/tasks', can('tasks', 'create'), async (req: Request, res: Response) => {
  const input = body(req, z.object({ title: z.string().trim().min(3).max(160), description: z.string().trim().max(2000).optional(), assigneeId: z.string().uuid(), dueAt: z.coerce.date().optional(), priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'), relatedType: z.string().max(20).optional(), relatedId: z.string().uuid().optional() }));
  if (input.assigneeId !== req.admin!.employeeId && !hasPermission(req, 'tasks', 'assign')) throw AppError.forbidden('You can only create tasks for yourself');
  const t = await prisma.$transaction(async (tx) => {
    const t = await tx.employeeTask.create({ data: { ...input, taskCode: await nextCodeRaw(tx, 'task_code_seq', 'TSK', 6), createdById: req.admin!.userId } });
    await audit({ action: 'task.created', entityType: 'task', entityId: t.id, module: 'tasks', newValue: { title: t.title, assigneeId: t.assigneeId }, req }, tx);
    return t;
  });
  const assignee = await prisma.employee.findUnique({ where: { id: input.assigneeId }, select: { userId: true } });
  if (assignee) await prisma.notification.create({ data: { userId: assignee.userId, type: 'ADMIN_ALERT', title: `New task ${t.taskCode}`, message: t.title, link: '/admin/tasks' } });
  created(res, 'Task created', { task: t });
});

adminWorkRouter.put('/tasks/:id', can('tasks', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const input = body(req, z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']).optional(), dueAt: z.coerce.date().optional(), priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional() }));
  const t = await prisma.employeeTask.findUnique({ where: { id } });
  if (!t || (t.assigneeId !== req.admin!.employeeId && !hasPermission(req, 'tasks', 'assign'))) throw AppError.notFound('Task not found');
  await prisma.employeeTask.update({ where: { id }, data: { ...input, completedAt: input.status === 'DONE' ? new Date() : input.status ? null : undefined } });
  await audit({ action: 'task.updated', entityType: 'task', entityId: id, module: 'tasks', previousValue: { status: t.status }, newValue: input as Prisma.InputJsonValue, req });
  ok(res, 'Task updated', null);
});
