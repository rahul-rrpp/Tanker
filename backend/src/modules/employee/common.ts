import type { Request, RequestHandler } from 'express';
import { portalEnabled } from '../../config/portals';
import { prisma } from '../../lib/prisma';
import { authenticateUser } from '../../middleware/auth';
import { AppError, ErrorCode } from '../../utils/errors';

/**
 * Employee guard. Identity comes from the database-backed session. It also fills req.admin, so the
 * existing can()/hasPermission() checks and data-scope rules apply unchanged. Super Admins are not
 * employees here, and only ACTIVE employees pass.
 */
export const requireEmployee: RequestHandler = (req, _res, next) => {
  const p = req.auth?.principal;
  if (!p) return next(AppError.unauthorized());
  if (!portalEnabled('employee')) return next(AppError.notFound('Employee portal is not enabled'));
  if (!p.roles.includes('EMPLOYEE') || p.roles.includes('SUPER_ADMIN') || !p.employee) return next(AppError.forbidden('An employee account is required'));
  if (p.employee.blocked || p.employee.employmentStatus !== 'ACTIVE') return next(AppError.forbidden('Your employee access is not active. Contact HR.', ErrorCode.ACCOUNT_DEACTIVATED));
  req.admin = { userId: p.userId, isSuper: false, employeeId: p.employee.employeeId, scope: p.employee.dataScope, name: p.fullName };
  next();
};

export const member: RequestHandler[] = [authenticateUser, requireEmployee];
export const empId = (req: Request) => req.admin!.employeeId!;
export const uid = (req: Request) => req.admin!.userId;
export const isAll = (req: Request) => req.admin!.scope === 'ALL';

export const todayIstStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
export const dateCol = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
export const istStart = (ymd: string) => new Date(`${ymd}T00:00:00+05:30`);

/** Ids of the caller's direct reports. */
export async function directReports(req: Request): Promise<string[]> {
  return (await prisma.employee.findMany({ where: { reportingManagerId: empId(req) }, select: { id: true } })).map((e) => e.id);
}

export async function assertActiveEmployee(id: string) {
  const e = await prisma.employee.findUnique({ where: { id }, select: { userId: true, employmentStatus: true, user: { select: { fullName: true } } } });
  if (!e || e.employmentStatus !== 'ACTIVE') throw AppError.badRequest('Select an active employee');
  return e;
}
