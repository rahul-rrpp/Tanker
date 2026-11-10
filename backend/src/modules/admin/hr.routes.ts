import { Prisma } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/errors';
import { ok } from '../../utils/response';
import { audit } from '../audit/audit';
import { clearSettingsCache, getSettings } from '../settings/settings.service';
import { adminAuth, body, can, dateRange, parseList, win } from './core';

/** Admin control of targets, leave entitlement, attendance rules, and read-only employee activity logs. */
export const adminHrRouter = Router();
adminHrRouter.use(...adminAuth);

adminHrRouter.get('/kpi-targets', can('performance', 'view'), async (_req: Request, res: Response) => {
  const [definitions, targets] = await Promise.all([prisma.kpiDefinition.findMany({ orderBy: { category: 'asc' } }), prisma.kpiTarget.findMany({ include: { role: { select: { code: true, name: true } }, employee: { select: { employeeCode: true } } } })]);
  ok(res, 'KPI targets', { definitions, targets });
});

adminHrRouter.put('/kpi-targets', can('performance', 'edit'), async (req: Request, res: Response) => {
  const i = body(req, z.object({ kpiCode: z.string().max(40), roleId: z.string().uuid().nullable().default(null), employeeId: z.string().uuid().nullable().default(null), monthlyTarget: z.number().min(0).max(100_000_000), weightage: z.number().int().min(0).max(100) }).strict().refine((v) => Boolean(v.roleId) !== Boolean(v.employeeId), 'Set either a role or an employee'));
  if (!(await prisma.kpiDefinition.findUnique({ where: { code: i.kpiCode } }))) throw AppError.badRequest('Unknown KPI');
  // NULLs are distinct in the unique index, so look the row up explicitly.
  const row = await prisma.kpiTarget.findFirst({ where: { kpiCode: i.kpiCode, roleId: i.roleId, employeeId: i.employeeId } });
  const data = { monthlyTarget: i.monthlyTarget, weightage: i.weightage, updatedById: req.admin!.userId };
  const saved = row ? await prisma.kpiTarget.update({ where: { id: row.id }, data }) : await prisma.kpiTarget.create({ data: { ...i, updatedById: req.admin!.userId } });
  await audit({ action: 'kpi.target_saved', entityType: 'kpi_target', entityId: saved.id, module: 'performance', previousValue: row ? { target: row.monthlyTarget.toNumber(), weight: row.weightage } : undefined, newValue: { target: i.monthlyTarget, weight: i.weightage }, req });
  ok(res, 'Target saved', { target: saved });
});

adminHrRouter.get('/leave-policies', can('settings', 'view'), async (_req: Request, res: Response) => ok(res, 'Leave policies', { items: await prisma.leavePolicy.findMany() }));

adminHrRouter.put('/leave-policies/:code', can('settings', 'edit'), async (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase().slice(0, 20);
  const i = body(req, z.object({ name: z.string().trim().min(2).max(60), daysPerYear: z.number().min(0).max(366), isActive: z.boolean().default(true) }).strict());
  const row = await prisma.leavePolicy.upsert({ where: { code }, update: i, create: { code, ...i } });
  await audit({ action: 'leave.policy_saved', entityType: 'leave_policy', module: 'settings', newValue: { code, ...i } as Prisma.InputJsonValue, req });
  ok(res, 'Policy saved', { policy: row });
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const rules = z.object({ shiftStart: hhmm, shiftEnd: hhmm, lateGraceMinutes: z.number().int().min(0).max(240), fullDayMinutes: z.number().int().min(60).max(960), halfDayMinutes: z.number().int().min(30).max(600), weeklyOffDays: z.array(z.number().int().min(0).max(6)).max(7), holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(100) }).partial().strict();

adminHrRouter.get('/attendance-rules', can('settings', 'view'), async (_req: Request, res: Response) => {
  const s = await getSettings();
  ok(res, 'Rules', { shiftStart: s.shiftStart, shiftEnd: s.shiftEnd, lateGraceMinutes: s.lateGraceMinutes, fullDayMinutes: s.fullDayMinutes, halfDayMinutes: s.halfDayMinutes, weeklyOffDays: s.weeklyOffDays, holidays: s.holidays });
});

adminHrRouter.put('/attendance-rules', can('settings', 'edit'), async (req: Request, res: Response) => {
  const input = body(req, rules);
  await prisma.$transaction(Object.entries(input).map(([key, value]) => prisma.platformSetting.upsert({ where: { key }, update: { value: value as Prisma.InputJsonValue }, create: { key, value: value as Prisma.InputJsonValue } })));
  clearSettingsCache();
  await audit({ action: 'attendance.rules_saved', entityType: 'settings', module: 'settings', newValue: input as Prisma.InputJsonValue, req });
  ok(res, 'Rules saved', null);
});

/** Read-only by construction: this router has no write route for audit rows. */
adminHrRouter.get('/activity-logs', can('audit', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { employeeId: z.string().uuid().optional(), action: z.string().max(80).optional() });
  const emp = q.employeeId ? await prisma.employee.findUnique({ where: { id: String(q.employeeId) }, select: { userId: true } }) : null;
  const where: Prisma.AuditLogWhereInput = { actorType: 'EMPLOYEE', ...(emp ? { actorUserId: emp.userId } : {}), ...(q.action ? { action: { contains: String(q.action) } } : {}), ...(dateRange(q) ? { createdAt: dateRange(q) } : {}) };
  const [total, rows] = await Promise.all([prisma.auditLog.count({ where }), prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...win(q, true), include: { actor: { select: { fullName: true, employee: { select: { employeeCode: true } } } } } })]);
  ok(res, 'Activity', { total, page: q.page, pageSize: q.pageSize, items: rows.map((r) => ({ id: r.id, employeeCode: r.actor?.employee?.employeeCode ?? null, employeeName: r.actor?.fullName ?? null, action: r.action, module: r.module, recordId: r.entityId, previousValue: r.previousValue, newValue: r.newValue, at: r.createdAt, ipAddress: r.ipAddress, sessionId: r.sessionId })) });
});

