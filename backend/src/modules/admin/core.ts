import type { Prisma } from '@prisma/client';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { adminPermissionKey, type AdminAction, type AdminModule } from '../../config/admin-permissions';
import { portalEnabled } from '../../config/portals';
import { prisma } from '../../lib/prisma';
import { authenticateUser } from '../../middleware/auth';
import { AppError, ErrorCode } from '../../utils/errors';
import { audit } from '../audit/audit';
import { reportToPdf, reportToXlsx } from '../reports/report.export';
import type { Format } from '../reports/report.service';

/**
 * Admin Portal core: authentication + module/action authorisation + data scope.
 *
 * Every admin endpoint is declared with `can(module, action)`. SUPER_ADMIN passes everything; employees
 * need the permission "adm.<module>.<action>" from their role (or a GRANT override, unless DENY'd).
 * Employees whose role has dataScope=ASSIGNED only ever see records assigned to them (enforced in the
 * queries via `scopeWhere`, so calling the API directly cannot bypass it).
 */

export interface AdminContext {
  userId: string;
  isSuper: boolean;
  employeeId: string | null;
  scope: 'ALL' | 'ASSIGNED';
  name: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    admin?: AdminContext;
  }
}

const adminOnly: RequestHandler = (req, _res, next) => {
  const p = req.auth?.principal;
  if (!p) return next(AppError.unauthorized());
  if (!portalEnabled('admin')) return next(AppError.notFound('Admin portal is not enabled'));
  const isSuper = p.roles.includes('SUPER_ADMIN');
  if (!isSuper && !(p.roles.includes('EMPLOYEE') && p.employee && !p.employee.blocked)) {
    return next(AppError.forbidden('Admin access required'));
  }
  req.admin = { userId: p.userId, isSuper, employeeId: p.employee?.employeeId ?? null, scope: isSuper ? 'ALL' : (p.employee?.dataScope ?? 'ASSIGNED'), name: p.fullName };
  next();
};

/** Authenticated admin (super admin or active employee). Mount once per admin router. */
export const adminAuth: RequestHandler[] = [authenticateUser, adminOnly];

export function hasPermission(req: Request, module: AdminModule, action: AdminAction): boolean {
  if (req.admin?.isSuper) return true;
  return Boolean(req.auth?.principal.permissions.includes(adminPermissionKey(module, action)));
}

export function can(module: AdminModule, action: AdminAction): RequestHandler {
  return (req, _res, next) => (hasPermission(req, module, action) ? next() : next(AppError.forbidden(`You do not have permission to ${action} ${module}`, ErrorCode.FORBIDDEN)));
}

export const superOnly: RequestHandler = (req, _res, next) => (req.admin?.isSuper ? next() : next(AppError.forbidden('Only the Super Admin can do this')));

/** Ids of companies / transporters currently assigned to the calling employee. */
export async function assignedIds(req: Request, entityType: 'COMPANY' | 'TRANSPORTER'): Promise<string[] | null> {
  if (!req.admin || req.admin.scope === 'ALL') return null;
  const rows = await prisma.employeeAssignment.findMany({ where: { employeeId: req.admin.employeeId!, entityType, endedAt: null }, select: { entityId: true } });
  return rows.map((r) => r.entityId);
}

/** Throws 404 when an ASSIGNED-scope employee touches a company/transporter that is not theirs. */
export async function assertInScope(req: Request, entityType: 'COMPANY' | 'TRANSPORTER', id: string) {
  const ids = await assignedIds(req, entityType);
  if (ids && !ids.includes(id)) throw AppError.notFound(`${entityType === 'COMPANY' ? 'Company' : 'Transporter'} not found`);
}

// ---- list helpers ------------------------------------------------------------------------

export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  q: z.string().trim().max(100).optional(),
  sort: z.string().trim().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  format: z.enum(['xlsx', 'pdf']).optional(),
});
export type ListQuery = z.infer<typeof listQuery>;

export function parseList(req: Request, extra?: z.ZodRawShape) {
  const schema = extra ? listQuery.extend(extra) : listQuery;
  const r = schema.safeParse(req.query);
  if (!r.success) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Invalid filters', r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
  return r.data as ListQuery & Record<string, unknown>;
}

export const dateRange = (q: { from?: string; to?: string }) =>
  q.from || q.to ? { ...(q.from ? { gte: new Date(`${q.from}T00:00:00+05:30`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999+05:30`) } : {}) } : undefined;

/** Only whitelisted sort fields reach Prisma. */
export function orderBy<T extends string>(q: ListQuery, allowed: readonly T[], fallback: T): Record<string, 'asc' | 'desc'> {
  const field = allowed.includes(q.sort as T) ? (q.sort as T) : fallback;
  return { [field]: q.order };
}

export const page = (q: ListQuery) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });
/** Page window, or the first 5,000 rows for exports. */
export const win = (q: ListQuery, paged: boolean) => (paged ? page(q) : { skip: 0, take: 5000 });

export type Column = { key: string; label: string; format: Format };

/** Sends either the JSON page or an Excel/PDF export of the same filtered list (export capped at 5,000 rows). */
export async function respondList(
  req: Request,
  res: Response,
  opts: { title: string; q: ListQuery; columns: Column[]; total: number; rows: Record<string, unknown>[]; exportRows?: () => Promise<Record<string, unknown>[]>; module: AdminModule },
) {
  if (opts.q.format) {
    if (!hasPermission(req, opts.module, 'export')) throw AppError.forbidden('You do not have permission to export this list');
    const rows = opts.exportRows ? await opts.exportRows() : opts.rows;
    const report = {
      key: 'total-bookings' as const,
      title: opts.title,
      description: `Exported by ${req.admin?.name ?? 'admin'}${opts.q.q ? ` · search "${opts.q.q}"` : ''}`,
      range: { from: opts.q.from ?? 'all', to: opts.q.to ?? 'all' },
      summary: [{ label: 'Rows', value: rows.length, format: 'number' as Format }],
      chart: null,
      columns: opts.columns,
      rows,
    };
    const buffer = opts.q.format === 'pdf' ? await reportToPdf(report, 'TankerLink Admin') : await reportToXlsx(report, 'TankerLink Admin');
    await audit({ action: 'admin.export', entityType: 'list', module: opts.module, metadata: { title: opts.title, rows: rows.length, format: opts.q.format }, req });
    res.setHeader('Content-Type', opts.q.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${opts.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${opts.q.format}"`);
    res.send(buffer);
    return;
  }
  res.json({ success: true, message: opts.title, data: { total: opts.total, page: opts.q.page, pageSize: opts.q.pageSize, columns: opts.columns, items: opts.rows } });
}

export const insensitive = (q?: string) => (q ? ({ contains: q, mode: 'insensitive' } as Prisma.StringFilter) : undefined);

/** Express 5 forwards rejected promises, but keep handlers typed. */
export type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown;

export const idParamSchema = z.object({ id: z.string().uuid('Invalid id') });
export function idOf(req: Request): string {
  const r = idParamSchema.safeParse(req.params);
  if (!r.success) throw AppError.notFound('Not found');
  return r.data.id;
}

export function body<T extends z.ZodTypeAny>(req: Request, schema: T): z.infer<T> {
  const r = schema.safeParse(req.body ?? {});
  if (!r.success) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Please correct the highlighted fields', r.error.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message })));
  return r.data;
}

/** Records a verification decision (shared by companies, transporters, drivers, tankers, documents). */
export async function recordReview(tx: Prisma.TransactionClient, input: { entityType: string; entityId: string; fromStatus?: string | null; toStatus: string; reason?: string | null; reviewerId: string }) {
  await tx.verificationReview.create({ data: { ...input, fromStatus: input.fromStatus ?? null, reason: input.reason ?? null } });
}
