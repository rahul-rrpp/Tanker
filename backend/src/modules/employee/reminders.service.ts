import type { NotificationType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { notifyUser } from '../notifications/notification.service';
import { getSettings } from '../settings/settings.service';
import { dateCol, istStart, todayIstStr } from './common';

/** Sends a reminder at most once per employee per item per day. */
async function once(userId: string, type: NotificationType, title: string, message: string, link: string, since: Date) {
  if (await prisma.notification.count({ where: { userId, type, title, createdAt: { gte: since } } })) return;
  await notifyUser(userId, { type, title, message, link });
}

export async function sweepEmployeeReminders() {
  const ymd = todayIstStr();
  const today = istStart(ymd);
  const tomorrow = new Date(today.getTime() + 86400_000);
  const [follow, tasks] = await Promise.all([
    prisma.followUp.findMany({ where: { status: 'PENDING', dueAt: { lt: tomorrow }, employeeId: { not: null } }, take: 500, select: { dueAt: true, lead: { select: { id: true, leadCode: true, name: true } }, employee: { select: { userId: true } } } }),
    prisma.employeeTask.findMany({ where: { status: { notIn: ['DONE', 'CANCELLED'] }, dueAt: { lt: tomorrow } }, take: 500, select: { id: true, title: true, assignee: { select: { userId: true } } } }),
  ]);
  for (const f of follow) await once(f.employee!.userId, 'FOLLOW_UP_DUE', `Follow-up due: ${f.lead.leadCode}`, f.lead.name, `/employee/leads/${f.lead.id}`, today);
  for (const t of tasks) await once(t.assignee.userId, 'TASK_DEADLINE', `Task due: ${t.title}`.slice(0, 160), 'This task is due today or overdue.', `/employee/tasks/${t.id}`, today);

  const s = await getSettings();
  const weekday = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  if (s.weeklyOffDays.includes(weekday) || s.holidays.includes(ymd)) return;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date()));
  const staff = await prisma.employee.findMany({ where: { employmentStatus: 'ACTIVE' }, select: { id: true, userId: true } });
  const date = dateCol(ymd);
  const onLeave = new Set((await prisma.leaveApplication.findMany({ where: { status: 'APPROVED', startDate: { lte: date }, endDate: { gte: date } }, select: { employeeId: true } })).map((l) => l.employeeId));
  if (hour >= 11) {
    const inToday = new Set((await prisma.employeeAttendance.findMany({ where: { date }, select: { employeeId: true } })).map((a) => a.employeeId));
    for (const e of staff) if (!inToday.has(e.id) && !onLeave.has(e.id)) await once(e.userId, 'ATTENDANCE_REMINDER', `Check in for ${ymd}`, 'You have not checked in today.', '/employee/attendance', today);
  }
  if (hour >= 18) {
    const done = new Set((await prisma.dailyMisReport.findMany({ where: { date }, select: { employeeId: true } })).map((r) => r.employeeId));
    for (const e of staff) if (!done.has(e.id) && !onLeave.has(e.id)) await once(e.userId, 'MIS_REMINDER', `Daily report for ${ymd}`, 'Your daily report is not submitted yet.', '/employee/mis', today);
  }
}
