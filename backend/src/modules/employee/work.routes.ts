import { Prisma } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { multipart, sendStoredFile, storeUpload } from '../../middleware/upload';
import { AppError } from '../../utils/errors';
import { created, ok } from '../../utils/response';
import { nextCodeRaw } from '../admin/codes';
import { body, can, dateRange, hasPermission, idOf, parseList, respondList, win } from '../admin/core';
import { addNote, notesFor } from '../admin/parties.routes';
import { audit } from '../audit/audit';
import { notifyUser } from '../notifications/notification.service';
import { getSettings } from '../settings/settings.service';
import { assertActiveEmployee, dateCol, directReports, empId, isAll, istStart, member, todayIstStr, uid } from './common';
import { kpiRows, type Period } from './performance.service';

export const workRouter = Router();
workRouter.use(...member);

// ---- Tasks ---------------------------------------------------------------------------------------

const TASK_STATUS = ['OPEN', 'IN_PROGRESS', 'PENDING', 'ON_HOLD', 'DONE', 'CANCELLED'] as const;
const canAssignTasks = (req: Request) => hasPermission(req, 'tasks', 'assign');

async function taskOr404(req: Request) {
  const t = await prisma.employeeTask.findFirst({ where: { id: idOf(req), ...(isAll(req) && canAssignTasks(req) ? {} : { OR: [{ assigneeId: empId(req) }, { createdById: uid(req) }] }) } });
  if (!t) throw AppError.notFound('Task not found');
  return t;
}

const log = (taskId: string, req: Request, data: { type: string; message?: string; fromValue?: string; toValue?: string; fileName?: string; storageKey?: string; mimeType?: string }) => prisma.employeeTaskActivity.create({ data: { taskId, actorId: uid(req), ...data } });

workRouter.get('/tasks', can('tasks', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { tab: z.string().optional(), team: z.string().optional() });
  const today = istStart(todayIstStr());
  const tomorrow = new Date(today.getTime() + 86400_000);
  const open = { notIn: ['DONE', 'CANCELLED'] };
  const TABS: Record<string, Prisma.EmployeeTaskWhereInput> = { today: { status: open, dueAt: { gte: today, lt: tomorrow } }, overdue: { status: open, dueAt: { lt: today } }, upcoming: { status: open, dueAt: { gte: tomorrow } }, completed: { status: 'DONE' } };
  const base: Prisma.EmployeeTaskWhereInput = q.team === '1' && canAssignTasks(req) ? (isAll(req) ? {} : { assignee: { reportingManagerId: empId(req) } }) : { assigneeId: empId(req) };
  const where = { ...base, ...(TABS[String(q.tab)] ?? {}) };
  const [total, items, ...counts] = await Promise.all([prisma.employeeTask.count({ where }), prisma.employeeTask.findMany({ where, orderBy: [{ dueAt: 'asc' }], ...win(q, true), include: { assignee: { select: { user: { select: { fullName: true } } } } } }), ...Object.values(TABS).map((w) => prisma.employeeTask.count({ where: { ...base, ...w } }))]);
  ok(res, 'Tasks', { total, page: q.page, pageSize: q.pageSize, items, counts: Object.fromEntries(Object.keys(TABS).map((k, i) => [k, counts[i]])), canAssign: canAssignTasks(req) });
});

const taskFields = { title: z.string().trim().min(3).max(160), description: z.string().trim().max(2000).optional(), priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'), startAt: z.coerce.date().optional(), dueAt: z.coerce.date().optional(), reminderAt: z.coerce.date().optional(), relatedCompanyId: z.string().uuid().optional(), relatedTransporterId: z.string().uuid().optional(), relatedBookingId: z.string().uuid().optional() };

workRouter.post('/tasks', can('tasks', 'view'), async (req: Request, res: Response) => {
  const { assigneeId, ...input } = body(req, z.object({ ...taskFields, assigneeId: z.string().uuid().optional() }).strict());
  const target = assigneeId ?? empId(req);
  if (target !== empId(req) && !canAssignTasks(req)) throw AppError.forbidden('Only authorised managers can assign tasks to others');
  const e = await assertActiveEmployee(target);
  const task = await prisma.$transaction(async (tx) => {
    const t = await tx.employeeTask.create({ data: { ...input, assigneeId: target, createdById: uid(req), taskCode: await nextCodeRaw(tx, 'task_code_seq', 'TSK', 6) } });
    await tx.employeeTaskActivity.create({ data: { taskId: t.id, type: 'CREATED', actorId: uid(req), toValue: 'OPEN' } });
    await audit({ action: 'task.created', entityType: 'employee_task', entityId: t.id, module: 'tasks', actorType: 'EMPLOYEE', newValue: { taskCode: t.taskCode, assigneeId: target }, req }, tx);
    return t;
  });
  if (target !== empId(req)) await notifyUser(e.userId, { type: 'TASK_ASSIGNED', title: `New task: ${task.title}`, message: `From ${req.admin!.name}`, link: `/employee/tasks/${task.id}` });
  created(res, `Task ${task.taskCode} created`, { task });
});

workRouter.get('/tasks/:id', can('tasks', 'view'), async (req: Request, res: Response) => {
  const t0 = await taskOr404(req);
  const [task, activities] = await Promise.all([prisma.employeeTask.findUniqueOrThrow({ where: { id: t0.id }, include: { assignee: { select: { user: { select: { fullName: true } } } } } }), prisma.employeeTaskActivity.findMany({ where: { taskId: t0.id }, orderBy: { createdAt: 'asc' }, select: { id: true, type: true, message: true, fromValue: true, toValue: true, fileName: true, createdAt: true, storageKey: true } })]);
  ok(res, 'Task', { task, activities: activities.map(({ storageKey, ...a }) => ({ ...a, hasFile: Boolean(storageKey) })) });
});

workRouter.put('/tasks/:id', can('tasks', 'view'), async (req: Request, res: Response) => {
  const t = await taskOr404(req);
  const input = body(req, z.object({ ...taskFields, status: z.enum(TASK_STATUS), completionRemarks: z.string().trim().max(1000) }).partial().strict());
  if (input.status === 'DONE' && !(input.completionRemarks ?? t.completionRemarks)) throw AppError.badRequest('Add completion remarks');
  const statusChanged = input.status && input.status !== t.status;
  await prisma.$transaction(async (tx) => {
    await tx.employeeTask.update({ where: { id: t.id }, data: { ...input, ...(input.status === 'DONE' ? { completedAt: new Date() } : {}) } });
    if (statusChanged) await tx.employeeTaskActivity.create({ data: { taskId: t.id, type: 'STATUS', fromValue: t.status, toValue: input.status, message: input.completionRemarks, actorId: uid(req) } });
    await audit({ action: input.status === 'DONE' ? 'task.completed' : 'task.updated', entityType: 'employee_task', entityId: t.id, module: 'tasks', actorType: 'EMPLOYEE', previousValue: { status: t.status }, newValue: { status: input.status ?? t.status }, req }, tx);
  });
  ok(res, 'Task updated', null);
});

workRouter.post('/tasks/:id/transfer', can('tasks', 'assign'), async (req: Request, res: Response) => {
  const t = await taskOr404(req);
  const { assigneeId, reason } = body(req, z.object({ assigneeId: z.string().uuid(), reason: z.string().trim().max(300).optional() }).strict());
  const e = await assertActiveEmployee(assigneeId);
  await prisma.$transaction([prisma.employeeTask.update({ where: { id: t.id }, data: { assigneeId } }), prisma.employeeTaskActivity.create({ data: { taskId: t.id, type: 'TRANSFER', message: reason, toValue: e.user.fullName.slice(0, 40), actorId: uid(req) } })]);
  await notifyUser(e.userId, { type: 'TASK_ASSIGNED', title: `Task transferred to you: ${t.title}`, message: reason ?? `From ${req.admin!.name}`, link: `/employee/tasks/${t.id}` });
  ok(res, 'Task transferred', null);
});

workRouter.post('/tasks/:id/remarks', can('tasks', 'view'), async (req: Request, res: Response) => {
  const t = await taskOr404(req);
  const { message } = body(req, z.object({ message: z.string().trim().min(2).max(1000) }).strict());
  await log(t.id, req, { type: 'REMARK', message });
  created(res, 'Remark added', null);
});

workRouter.post('/tasks/:id/attachments', can('tasks', 'view'), multipart({ field: 'file' }), async (req: Request, res: Response) => {
  const t = await taskOr404(req);
  const f = await storeUpload(req.file, 'support-attachments', ['pdf', 'png', 'jpeg', 'webp']);
  await log(t.id, req, { type: 'ATTACHMENT', fileName: f.fileName, storageKey: f.storageKey, mimeType: f.mimeType });
  created(res, 'File attached', null);
});

workRouter.get('/tasks/:id/attachments/:att', can('tasks', 'view'), async (req: Request, res: Response) => {
  const t = await taskOr404(req);
  const a = await prisma.employeeTaskActivity.findFirst({ where: { id: String(req.params.att), taskId: t.id, storageKey: { not: null } } });
  if (!a) throw AppError.notFound('Attachment not found');
  sendStoredFile(res, { storageKey: a.storageKey!, fileName: a.fileName!, mimeType: a.mimeType! }, req.query.inline === '1');
});

// ---- Attendance: rules come from platform settings ----------------------------------------------

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const istMinutes = (d: Date) => { const s = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(d); return minutes(s); };
const P2002 = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

async function todayRow(req: Request) {
  return prisma.employeeAttendance.findUnique({ where: { employeeId_date: { employeeId: empId(req), date: dateCol(todayIstStr()) } } });
}

workRouter.post('/attendance/check-in', async (req: Request, res: Response) => {
  // Coordinates are stored only when the employee ticked consent in that same request.
  const input = body(req, z.object({ consent: z.boolean().default(false), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(), remarks: z.string().trim().max(300).optional() }).strict());
  const s = await getSettings();
  const ymd = todayIstStr();
  const now = new Date();
  const weekday = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  const status = s.holidays.includes(ymd) ? 'HOLIDAY' : s.weeklyOffDays.includes(weekday) ? 'WEEKLY_OFF' : istMinutes(now) > minutes(s.shiftStart) + s.lateGraceMinutes ? 'LATE' : 'PRESENT';
  try {
    const row = await prisma.employeeAttendance.create({ data: { employeeId: empId(req), date: dateCol(ymd), checkInAt: now, status, remarks: input.remarks, locationConsent: input.consent, ...(input.consent ? { checkInLatitude: input.latitude, checkInLongitude: input.longitude } : {}), events: { create: { type: 'CHECK_IN', at: now } } } });
    await audit({ action: 'attendance.check_in', entityType: 'attendance', entityId: row.id, module: 'attendance', actorType: 'EMPLOYEE', metadata: { status }, req });
    created(res, status === 'LATE' ? 'Checked in (late arrival)' : 'Checked in', { attendance: row });
  } catch (e) {
    if (P2002(e)) throw AppError.conflict('You have already checked in today');
    throw e;
  }
});

workRouter.post('/attendance/check-out', async (req: Request, res: Response) => {
  const r = await todayRow(req);
  if (!r?.checkInAt) throw AppError.conflict('Check in first');
  if (r.checkOutAt) throw AppError.conflict('You have already checked out today');
  const s = await getSettings();
  const now = new Date();
  const openBreak = r.breakStartedAt ? Math.round((now.getTime() - r.breakStartedAt.getTime()) / 60000) : 0;
  const breakMinutes = r.breakMinutes + openBreak;
  const workingMinutes = Math.max(0, Math.round((now.getTime() - r.checkInAt.getTime()) / 60000) - breakMinutes);
  const status = ['HOLIDAY', 'WEEKLY_OFF'].includes(r.status) ? r.status : workingMinutes < s.halfDayMinutes ? 'ABSENT' : workingMinutes < s.fullDayMinutes ? 'HALF_DAY' : r.status;
  const moved = await prisma.employeeAttendance.updateMany({ where: { id: r.id, checkOutAt: null }, data: { checkOutAt: now, breakMinutes, breakStartedAt: null, workingMinutes, status, earlyDeparture: istMinutes(now) < minutes(s.shiftEnd) } });
  if (moved.count !== 1) throw AppError.conflict('You have already checked out today');
  await prisma.attendanceEvent.create({ data: { attendanceId: r.id, type: 'CHECK_OUT', at: now } });
  await audit({ action: 'attendance.check_out', entityType: 'attendance', entityId: r.id, module: 'attendance', actorType: 'EMPLOYEE', metadata: { workingMinutes, status }, req });
  ok(res, 'Checked out', { workingMinutes, status });
});

for (const [path, type] of [['break-start', 'BREAK_START'], ['break-end', 'BREAK_END']] as const) {
  workRouter.post(`/attendance/${path}`, async (req: Request, res: Response) => {
    const r = await todayRow(req);
    if (!r?.checkInAt || r.checkOutAt) throw AppError.conflict('You are not checked in');
    const now = new Date();
    if (type === 'BREAK_START') {
      if (r.breakStartedAt) throw AppError.conflict('A break is already running');
      await prisma.employeeAttendance.update({ where: { id: r.id }, data: { breakStartedAt: now } });
    } else {
      if (!r.breakStartedAt) throw AppError.conflict('No break is running');
      await prisma.employeeAttendance.update({ where: { id: r.id }, data: { breakStartedAt: null, breakMinutes: r.breakMinutes + Math.round((now.getTime() - r.breakStartedAt.getTime()) / 60000) } });
    }
    await prisma.attendanceEvent.create({ data: { attendanceId: r.id, type, at: now } });
    ok(res, type === 'BREAK_START' ? 'Break started' : 'Break ended', null);
  });
}

workRouter.get('/attendance', async (req: Request, res: Response) => {
  const q = parseList(req);
  const where: Prisma.EmployeeAttendanceWhereInput = { employeeId: empId(req), ...(q.from || q.to ? { date: { ...(q.from ? { gte: dateCol(q.from) } : {}), ...(q.to ? { lte: dateCol(q.to) } : {}) } } : {}) };
  const [today, total, items] = await Promise.all([todayRow(req), prisma.employeeAttendance.count({ where }), prisma.employeeAttendance.findMany({ where, orderBy: { date: 'desc' }, ...win(q, true) })]);
  ok(res, 'Attendance', { today, total, page: q.page, pageSize: q.pageSize, items });
});

/** Team view: HR with attendance permission sees all; a manager sees direct reports. */
async function teamIds(req: Request, module: 'attendance' | 'mis'): Promise<string[] | null> {
  if (hasPermission(req, module, 'view') && isAll(req)) return null;
  const r = await directReports(req);
  if (r.length === 0 && !hasPermission(req, module, 'view')) throw AppError.forbidden();
  return r;
}

workRouter.get('/attendance/team', async (req: Request, res: Response) => {
  const ids = await teamIds(req, 'attendance');
  const q = parseList(req, { report: z.string().optional() });
  const date = q.from ? dateCol(q.from) : dateCol(todayIstStr());
  const to = q.to ? dateCol(q.to) : date;
  const where: Prisma.EmployeeAttendanceWhereInput = { date: { gte: date, lte: to }, ...(ids ? { employeeId: { in: ids } } : {}), ...(q.report === 'late' ? { status: 'LATE' } : q.report === 'absence' ? { status: 'ABSENT' } : {}) };
  const include = { employee: { select: { employeeCode: true, user: { select: { fullName: true } } } } } as const;
  const fetch = (paged: boolean) => prisma.employeeAttendance.findMany({ where, orderBy: [{ date: 'desc' }], ...win(q, paged), include });
  const shape = (rows: Awaited<ReturnType<typeof fetch>>) => rows.map((a) => ({ ...a, employeeCode: a.employee.employeeCode, name: a.employee.user.fullName, hours: a.workingMinutes === null ? null : Math.round(a.workingMinutes / 6) / 10, employee: undefined }));
  const [total, rows] = await Promise.all([prisma.employeeAttendance.count({ where }), fetch(true)]);
  await respondList(req, res, { title: 'Attendance', q, total, rows: shape(rows), exportRows: async () => shape(await fetch(false)), module: 'attendance', columns: [{ key: 'employeeCode', label: 'Employee', format: 'text' }, { key: 'name', label: 'Name', format: 'text' }, { key: 'date', label: 'Date', format: 'date' }, { key: 'checkInAt', label: 'In', format: 'datetime' }, { key: 'checkOutAt', label: 'Out', format: 'datetime' }, { key: 'hours', label: 'Hours', format: 'number' }, { key: 'status', label: 'Status', format: 'text' }] });
});

// ---- Leave --------------------------------------------------------------------------------------

async function leaveDays(start: Date, end: Date) {
  const s = await getSettings();
  let n = 0;
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400_000)) if (!s.weeklyOffDays.includes(d.getUTCDay()) && !s.holidays.includes(d.toISOString().slice(0, 10))) n++;
  return n;
}

async function balances(employeeId: string, year: number) {
  const policies = await prisma.leavePolicy.findMany({ where: { isActive: true } });
  for (const p of policies) await prisma.leaveBalance.upsert({ where: { employeeId_leaveType_year: { employeeId, leaveType: p.code, year } }, update: {}, create: { employeeId, leaveType: p.code, year, entitled: p.daysPerYear } });
  const rows = await prisma.leaveBalance.findMany({ where: { employeeId, year } });
  return rows.map((b) => ({ leaveType: b.leaveType, name: policies.find((p) => p.code === b.leaveType)?.name ?? b.leaveType, entitled: b.entitled.toNumber(), used: b.used.toNumber(), available: b.entitled.minus(b.used).toNumber() }));
}

workRouter.get('/leaves', async (req: Request, res: Response) => {
  const [items, bal] = await Promise.all([prisma.leaveApplication.findMany({ where: { employeeId: empId(req) }, orderBy: { createdAt: 'desc' }, take: 100, omit: { storageKey: true } }), balances(empId(req), Number(todayIstStr().slice(0, 4)))]);
  ok(res, 'Leave', { items, balances: bal });
});

workRouter.post('/leaves', multipart({ field: 'file' }), async (req: Request, res: Response) => {
  const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const input = z.object({ leaveType: z.string().min(2).max(20), startDate: ymd, endDate: ymd, reason: z.string().trim().min(5).max(500) }).strict().parse(req.body ?? {});
  const start = dateCol(input.startDate);
  const end = dateCol(input.endDate);
  if (end < start) throw AppError.badRequest('End date must be on or after the start date');
  const days = await leaveDays(start, end);
  if (days === 0) throw AppError.badRequest('These dates contain no working days');
  const bal = (await balances(empId(req), start.getUTCFullYear())).find((b) => b.leaveType === input.leaveType);
  if (!bal) throw AppError.badRequest('Choose a valid leave type');
  if (days > bal.available) throw AppError.conflict(`Only ${bal.available} day(s) of ${bal.name} available`);
  if (await prisma.leaveApplication.count({ where: { employeeId: empId(req), status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: end }, endDate: { gte: start } } })) throw AppError.conflict('You already have leave on these dates');
  const file = req.file ? await storeUpload(req.file, 'support-attachments', ['pdf', 'png', 'jpeg']) : null;
  const leave = await prisma.leaveApplication.create({ data: { employeeId: empId(req), leaveType: input.leaveType, startDate: start, endDate: end, days, reason: input.reason, ...(file ? { fileName: file.fileName, storageKey: file.storageKey, mimeType: file.mimeType } : {}) }, omit: { storageKey: true } });
  await audit({ action: 'leave.applied', entityType: 'leave', entityId: leave.id, module: 'leave', actorType: 'EMPLOYEE', metadata: { days, type: input.leaveType }, req });
  const mgr = await prisma.employee.findUnique({ where: { id: empId(req) }, select: { reportingManager: { select: { userId: true } } } });
  if (mgr?.reportingManager) await notifyUser(mgr.reportingManager.userId, { type: 'LEAVE_UPDATE', title: `Leave request from ${req.admin!.name}`, message: `${days} day(s) from ${input.startDate}`, link: '/employee/leave-approvals' });
  created(res, 'Leave applied', { leave });
});

workRouter.post('/leaves/:id/cancel', async (req: Request, res: Response) => {
  const r = await prisma.leaveApplication.updateMany({ where: { id: idOf(req), employeeId: empId(req), status: 'PENDING' }, data: { status: 'CANCELLED' } });
  if (r.count === 0) throw AppError.conflict('Only your own pending applications can be cancelled');
  ok(res, 'Application cancelled', null);
});

/** Reporting manager of the applicant, or HR with the leave permission. Never the applicant. */
async function leaveToDecide(req: Request, perm: 'approve' | 'reject') {
  const l = await prisma.leaveApplication.findUnique({ where: { id: idOf(req) }, include: { employee: { select: { reportingManagerId: true, userId: true } } } });
  if (!l) throw AppError.notFound('Application not found');
  if (l.employeeId === empId(req)) throw AppError.forbidden('You cannot decide your own leave');
  if (l.employee.reportingManagerId !== empId(req) && !hasPermission(req, 'leave', perm)) throw AppError.notFound('Application not found');
  if (l.status !== 'PENDING') throw AppError.conflict('This application has already been decided');
  return l;
}

workRouter.get('/leaves/approvals', async (req: Request, res: Response) => {
  const all = hasPermission(req, 'leave', 'view');
  const items = await prisma.leaveApplication.findMany({ where: { status: 'PENDING', employeeId: { not: empId(req) }, ...(all ? {} : { employee: { reportingManagerId: empId(req) } }) }, orderBy: { createdAt: 'asc' }, take: 200, omit: { storageKey: true }, include: { employee: { select: { employeeCode: true, user: { select: { fullName: true } } } } } });
  ok(res, 'Pending leave', { items });
});

workRouter.post('/leaves/:id/approve', async (req: Request, res: Response) => {
  const l = await leaveToDecide(req, 'approve');
  const { note } = body(req, z.object({ note: z.string().trim().max(300).optional() }).strict());
  await balances(l.employeeId, l.startDate.getUTCFullYear());
  await prisma.$transaction(async (tx) => {
    // Atomic: two approvals can never overdraw a balance.
    const n = await tx.$executeRaw`UPDATE leave_balances SET used = used + ${l.days.toNumber()}::numeric WHERE "employeeId" = ${l.employeeId}::uuid AND "leaveType" = ${l.leaveType} AND year = ${l.startDate.getUTCFullYear()} AND used + ${l.days.toNumber()}::numeric <= entitled`;
    if (n !== 1) throw AppError.conflict('Not enough leave balance');
    const moved = await tx.leaveApplication.updateMany({ where: { id: l.id, status: 'PENDING' }, data: { status: 'APPROVED', decidedById: uid(req), decisionNote: note, decidedAt: new Date() } });
    if (moved.count !== 1) throw AppError.conflict('This application has already been decided');
    await audit({ action: 'leave.approved', entityType: 'leave', entityId: l.id, module: 'leave', actorType: 'EMPLOYEE', req }, tx);
  });
  await notifyUser(l.employee.userId, { type: 'LEAVE_UPDATE', title: 'Leave approved', message: note ?? `${l.days.toNumber()} day(s) approved`, link: '/employee/leave' });
  ok(res, 'Leave approved', null);
});

workRouter.post('/leaves/:id/reject', async (req: Request, res: Response) => {
  const l = await leaveToDecide(req, 'reject');
  const { note } = body(req, z.object({ note: z.string().trim().min(3).max(300) }).strict());
  const moved = await prisma.leaveApplication.updateMany({ where: { id: l.id, status: 'PENDING' }, data: { status: 'REJECTED', decidedById: uid(req), decisionNote: note, decidedAt: new Date() } });
  if (moved.count !== 1) throw AppError.conflict('This application has already been decided');
  await audit({ action: 'leave.rejected', entityType: 'leave', entityId: l.id, module: 'leave', actorType: 'EMPLOYEE', metadata: { note }, req });
  await notifyUser(l.employee.userId, { type: 'LEAVE_UPDATE', title: 'Leave rejected', message: note, link: '/employee/leave' });
  ok(res, 'Leave rejected', null);
});

workRouter.get('/leaves/:id/file', async (req: Request, res: Response) => {
  const l = await prisma.leaveApplication.findUnique({ where: { id: idOf(req) }, include: { employee: { select: { reportingManagerId: true } } } });
  if (!l?.storageKey || (l.employeeId !== empId(req) && l.employee.reportingManagerId !== empId(req) && !hasPermission(req, 'leave', 'view'))) throw AppError.notFound('File not found');
  sendStoredFile(res, { storageKey: l.storageKey, fileName: l.fileName!, mimeType: l.mimeType! }, req.query.inline === '1');
});

// ---- Daily MIS ----------------------------------------------------------------------------------

const REPORT_FOR: Record<string, string> = { SALES_EXECUTIVE: 'SALES', FIELD_SALES_EXECUTIVE: 'SALES', TELE_SALES_EXECUTIVE: 'SALES', SALES_MANAGER: 'SALES', OPERATIONS_EXECUTIVE: 'OPERATIONS', OPERATIONS_MANAGER: 'OPERATIONS', VERIFICATION_EXECUTIVE: 'VERIFICATION', ACCOUNTS_EXECUTIVE: 'ACCOUNTS' };
const reportType = (req: Request) => REPORT_FOR[req.auth!.principal.employee!.roleCode] ?? 'GENERAL';
const misData = z.record(z.string().max(40), z.union([z.number().min(0).max(1_000_000), z.string().trim().max(2000)])).refine((o) => Object.keys(o).length <= 40, 'Too many fields');

workRouter.get('/mis', async (req: Request, res: Response) => {
  const q = parseList(req);
  const where = { employeeId: empId(req) };
  const [today, total, items] = await Promise.all([prisma.dailyMisReport.findUnique({ where: { employeeId_date: { employeeId: empId(req), date: dateCol(todayIstStr()) } } }), prisma.dailyMisReport.count({ where }), prisma.dailyMisReport.findMany({ where, orderBy: { date: 'desc' }, ...win(q, true) })]);
  ok(res, 'MIS', { reportType: reportType(req), today, total, page: q.page, pageSize: q.pageSize, items });
});

workRouter.post('/mis', async (req: Request, res: Response) => {
  const { data } = body(req, z.object({ data: misData }).strict());
  try {
    const report = await prisma.dailyMisReport.create({ data: { employeeId: empId(req), date: dateCol(todayIstStr()), reportType: reportType(req), data } });
    await audit({ action: 'mis.submitted', entityType: 'daily_mis', entityId: report.id, module: 'mis', actorType: 'EMPLOYEE', req });
    created(res, 'Daily report submitted', { report });
  } catch (e) {
    if (P2002(e)) throw AppError.conflict('You have already submitted today’s report');
    throw e;
  }
});

/** Authorised correction only, and the previous version is always kept. */
workRouter.put('/mis/:id', can('mis', 'edit'), async (req: Request, res: Response) => {
  const r = await prisma.dailyMisReport.findUnique({ where: { id: idOf(req) } });
  if (!r) throw AppError.notFound('Report not found');
  const { data, reason } = body(req, z.object({ data: misData, reason: z.string().trim().min(5).max(300) }).strict());
  await prisma.$transaction(async (tx) => {
    await tx.misReportRevision.create({ data: { reportId: r.id, revision: r.revision + 1, previous: r.data as Prisma.InputJsonValue, reason, editedById: uid(req) } });
    await tx.dailyMisReport.update({ where: { id: r.id }, data: { data, revision: { increment: 1 } } });
    await audit({ action: 'mis.revised', entityType: 'daily_mis', entityId: r.id, module: 'mis', actorType: 'EMPLOYEE', previousValue: r.data as Prisma.InputJsonValue, newValue: data, metadata: { reason }, req }, tx);
  });
  ok(res, 'Report revised', null);
});

workRouter.get('/mis/:id/revisions', can('mis', 'view'), async (req: Request, res: Response) => {
  ok(res, 'Revisions', { items: await prisma.misReportRevision.findMany({ where: { reportId: idOf(req) }, orderBy: { revision: 'desc' } }) });
});

/** Consolidated MIS for a date, including who has not submitted. */
workRouter.get('/mis-team', async (req: Request, res: Response) => {
  const ids = await teamIds(req, 'mis');
  const q = parseList(req);
  const ymd = q.from ?? todayIstStr();
  const date = dateCol(ymd);
  const employees = await prisma.employee.findMany({ where: { employmentStatus: 'ACTIVE', ...(ids ? { id: { in: ids } } : {}) }, select: { id: true, employeeCode: true, department: true, user: { select: { fullName: true } } } });
  const reports = await prisma.dailyMisReport.findMany({ where: { date, employeeId: { in: employees.map((e) => e.id) } } });
  const seen = new Set(reports.map((r) => r.employeeId));
  const name = (id: string) => employees.find((e) => e.id === id);
  const totals: Record<string, number> = {};
  for (const r of reports) for (const [k, v] of Object.entries(r.data as Record<string, unknown>)) if (typeof v === 'number') totals[k] = (totals[k] ?? 0) + v;
  ok(res, 'Team MIS', { date: ymd, submitted: reports.map((r) => ({ ...r, employeeCode: name(r.employeeId)?.employeeCode, name: name(r.employeeId)?.user.fullName })), missing: employees.filter((e) => !seen.has(e.id)).map((e) => ({ id: e.id, employeeCode: e.employeeCode, name: e.user.fullName, department: e.department })), totals, canRevise: hasPermission(req, 'mis', 'edit') });
});

// ---- Performance --------------------------------------------------------------------------------

async function subject(req: Request) {
  const id = typeof req.query.employeeId === 'string' && req.query.employeeId ? req.query.employeeId : empId(req);
  if (id !== empId(req)) {
    const full = hasPermission(req, 'performance', 'view') && isAll(req);
    if (!full && !(await directReports(req)).includes(id)) throw AppError.notFound('Employee not found');
  }
  const e = await prisma.employee.findUnique({ where: { id }, select: { id: true, userId: true, roleId: true, employeeCode: true, user: { select: { fullName: true } }, role: { select: { name: true } } } });
  if (!e) throw AppError.notFound('Employee not found');
  return e;
}
const periodOf = (req: Request): Period => (['day', 'week', 'month'].includes(String(req.query.period)) ? (req.query.period as Period) : 'month');

workRouter.get('/performance', async (req: Request, res: Response) => {
  const e = await subject(req);
  const data = await kpiRows(e, periodOf(req));
  ok(res, 'Scorecard', { employee: { id: e.id, code: e.employeeCode, name: e.user.fullName, role: e.role.name }, ...data });
});

workRouter.get('/performance/targets', async (req: Request, res: Response) => {
  const e = await subject(req);
  ok(res, 'Targets', { items: (await kpiRows(e, 'month')).rows.map((r) => ({ kpiCode: r.code, kpi: r.kpi, monthlyTarget: r.monthlyTarget, weight: r.weight })) });
});

/** Ranking and team list: managers see direct reports; all-scope performance viewers see everyone. */
workRouter.get('/performance/team', async (req: Request, res: Response) => {
  const full = hasPermission(req, 'performance', 'view') && isAll(req);
  const ids = full ? null : await directReports(req);
  if (ids && ids.length === 0) throw AppError.forbidden();
  const employees = await prisma.employee.findMany({ where: { employmentStatus: 'ACTIVE', ...(ids ? { id: { in: ids } } : {}) }, select: { id: true, userId: true, roleId: true, employeeCode: true, user: { select: { fullName: true } }, role: { select: { name: true } } }, take: 200 });
  const scored = [];
  for (const e of employees) { const d = await kpiRows(e, 'month'); scored.push({ id: e.id, code: e.employeeCode, name: e.user.fullName, role: e.role.name, score: d.totalScore, rating: d.rating, configured: d.rows.length > 0 }); }
  ok(res, 'Team performance', { items: scored.sort((a, b) => b.score - a.score) });
});

// ---- Payment follow-ups: read and annotate. Nothing here writes a financial record. ----------------

workRouter.get('/payments/summary', can('payments', 'view'), async (_req: Request, res: Response) => {
  const [due, paid, failed, refunds, settlements] = await Promise.all([
    prisma.invoice.aggregate({ where: { status: { not: 'CANCELLED' } }, _sum: { totalAmount: true } }),
    prisma.payment.aggregate({ where: { status: 'PAID' }, _sum: { amount: true } }),
    prisma.payment.count({ where: { status: 'FAILED' } }),
    prisma.refundRequest.count({ where: { status: 'REQUESTED' } }),
    prisma.settlement.aggregate({ where: { status: { in: ['PENDING', 'ON_HOLD'] } }, _sum: { amount: true }, _count: true }),
  ]);
  const totalDue = due._sum.totalAmount?.toNumber() ?? 0;
  const received = paid._sum.amount?.toNumber() ?? 0;
  ok(res, 'Summary', { totalCollectionDue: totalDue, collectionReceived: received, pendingCollection: Math.max(0, Math.round((totalDue - received) * 100) / 100), failedPayments: failed, refundRequests: refunds, pendingSettlements: settlements._sum.amount?.toNumber() ?? 0, pendingSettlementCount: settlements._count });
});

workRouter.get('/payments', can('payments', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { status: z.string().optional() });
  const where: Prisma.BookingWhereInput = { acceptedFreight: { not: null }, ...(q.status ? { paymentStatus: q.status as never } : {}), ...(dateRange(q) ? { createdAt: dateRange(q) } : {}), ...(q.q ? { OR: [{ bookingCode: { contains: q.q, mode: 'insensitive' } }, { company: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}) };
  const fetch = (paged: boolean) => prisma.booking.findMany({ where, orderBy: { createdAt: 'desc' }, ...win(q, paged), select: { id: true, bookingCode: true, paymentStatus: true, company: { select: { name: true } }, invoices: { where: { status: { not: 'CANCELLED' } }, select: { totalAmount: true } }, payments: { where: { status: 'PAID' }, select: { amount: true } } } });
  const shape = (rows: Awaited<ReturnType<typeof fetch>>) => rows.map((b) => { const inv = b.invoices.reduce((n, i) => n + i.totalAmount.toNumber(), 0); const p = b.payments.reduce((n, i) => n + i.amount.toNumber(), 0); return { id: b.id, bookingCode: b.bookingCode, company: b.company.name, invoiced: inv, paid: p, outstanding: Math.max(0, Math.round((inv - p) * 100) / 100), paymentStatus: b.paymentStatus }; });
  const [total, rows] = await Promise.all([prisma.booking.count({ where }), fetch(true)]);
  await respondList(req, res, { title: 'Payment statement', q, total, rows: shape(rows), exportRows: async () => shape(await fetch(false)), module: 'payments', columns: [{ key: 'bookingCode', label: 'Booking', format: 'text' }, { key: 'company', label: 'Company', format: 'text' }, { key: 'invoiced', label: 'Invoiced', format: 'currency' }, { key: 'paid', label: 'Paid', format: 'currency' }, { key: 'outstanding', label: 'Outstanding', format: 'currency' }, { key: 'paymentStatus', label: 'Status', format: 'text' }] });
});

workRouter.get('/payments/settlements', can('commissions', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { status: z.string().optional() });
  const where = q.status ? { status: String(q.status) } : {};
  const [total, items] = await Promise.all([prisma.settlement.count({ where }), prisma.settlement.findMany({ where, orderBy: { createdAt: 'desc' }, ...win(q, true), select: { id: true, settlementCode: true, amount: true, status: true, settledAt: true, transporter: { select: { companyName: true } } } })]);
  ok(res, 'Settlements', { total, page: q.page, pageSize: q.pageSize, items });
});

workRouter.get('/payments/:id/notes', can('payments', 'view'), async (req: Request, res: Response) => ok(res, 'Notes', { notes: await notesFor('PAYMENT_FOLLOWUP', idOf(req)) }));

workRouter.post('/payments/:id/notes', can('payments', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  if (!(await prisma.booking.count({ where: { id } }))) throw AppError.notFound('Booking not found');
  const { note, kind } = body(req, z.object({ note: z.string().trim().min(2).max(2000), kind: z.enum(['FOLLOW_UP', 'RECONCILIATION', 'ESCALATION']).default('FOLLOW_UP') }).strict());
  await audit({ action: 'payment.follow_up', entityType: 'booking', entityId: id, module: 'payments', actorType: 'EMPLOYEE', metadata: { kind }, req });
  created(res, 'Recorded', { note: await addNote(req, 'PAYMENT_FOLLOWUP', id, `${kind}: ${note}`) });
});

// ---- Notifications and profile ------------------------------------------------------------------

workRouter.get('/notifications', async (req: Request, res: Response) => {
  const q = parseList(req, { unread: z.string().optional() });
  const where = { userId: uid(req), ...(q.unread === '1' ? { readAt: null } : {}) };
  const [total, unread, items] = await Promise.all([prisma.notification.count({ where }), prisma.notification.count({ where: { userId: uid(req), readAt: null } }), prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...win(q, true) })]);
  ok(res, 'Notifications', { total, unread, page: q.page, pageSize: q.pageSize, items });
});

workRouter.put('/notifications/read-all', async (req: Request, res: Response) => {
  await prisma.notification.updateMany({ where: { userId: uid(req), readAt: null }, data: { readAt: new Date() } });
  ok(res, 'All marked as read', null);
});

workRouter.put('/notifications/:id/read', async (req: Request, res: Response) => {
  const r = await prisma.notification.updateMany({ where: { id: idOf(req), userId: uid(req) }, data: { readAt: new Date() } });
  if (r.count === 0) throw AppError.notFound('Notification not found');
  ok(res, 'Marked as read', null);
});

