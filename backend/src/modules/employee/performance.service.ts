import { prisma } from '../../lib/prisma';
import { istStart, todayIstStr } from './common';

export type Period = 'day' | 'week' | 'month';
type Emp = { id: string; userId: string; roleId: string };
type Range = { gte: Date; lte: Date };

/** Live value of each KPI for one employee. Every KPI is counted from source records. */
const ACTUALS: Record<string, (e: Emp, r: Range) => Promise<number>> = {
  LEADS_ASSIGNED: (e, r) => prisma.lead.count({ where: { assignedEmployeeId: e.id, createdAt: r, deletedAt: null } }),
  CALLS_MADE: (e, r) => prisma.leadActivity.count({ where: { actorId: e.userId, type: 'CALL', createdAt: r } }),
  CONNECTED_CALLS: (e, r) => prisma.leadActivity.count({ where: { actorId: e.userId, type: 'CALL', connected: true, createdAt: r } }),
  MEETINGS: (e, r) => prisma.leadActivity.count({ where: { actorId: e.userId, type: 'MEETING', createdAt: r } }),
  FOLLOW_UPS_DONE: (e, r) => prisma.followUp.count({ where: { employeeId: e.id, status: 'DONE', completedAt: r } }),
  NEW_COMPANIES: (e, r) => prisma.company.count({ where: { createdById: e.userId, createdAt: r } }),
  NEW_TRANSPORTERS: (e, r) => prisma.agency.count({ where: { createdById: e.userId, createdAt: r } }),
  VERIFIED_REGISTRATIONS: async (e, r) => (await prisma.company.count({ where: { createdById: e.userId, verifiedAt: r } })) + (await prisma.agency.count({ where: { createdById: e.userId, verifiedAt: r } })),
  FIRST_BOOKINGS: async (e, r) => {
    const cs = await prisma.company.findMany({ where: { createdById: e.userId }, select: { bookings: { orderBy: { createdAt: 'asc' }, take: 1, select: { createdAt: true } } } });
    return cs.filter((c) => c.bookings[0] && c.bookings[0].createdAt >= r.gte && c.bookings[0].createdAt <= r.lte).length;
  },
  REPEAT_BOOKINGS: async (e, r) => {
    const cs = await prisma.company.findMany({ where: { createdById: e.userId }, select: { bookings: { orderBy: { createdAt: 'asc' }, select: { createdAt: true } } } });
    return cs.reduce((n, c) => n + c.bookings.slice(1).filter((b) => b.createdAt >= r.gte && b.createdAt <= r.lte).length, 0);
  },
  BOOKINGS_MANAGED: (e, r) => prisma.booking.count({ where: { createdById: e.userId, createdAt: r } }),
  TRIPS_COMPLETED: async (e, r) => {
    const a = await prisma.employeeAssignment.findMany({ where: { employeeId: e.id, entityType: 'COMPANY', endedAt: null }, select: { entityId: true } });
    return prisma.trip.count({ where: { status: 'COMPLETED', completedAt: r, booking: { companyId: { in: a.map((x) => x.entityId) } } } });
  },
  DELAYED_TRIPS: async (e, r) => {
    const a = await prisma.employeeAssignment.findMany({ where: { employeeId: e.id, entityType: 'COMPANY', endedAt: null }, select: { entityId: true } });
    return prisma.trip.count({ where: { exception: 'DELAYED', createdAt: r, booking: { companyId: { in: a.map((x) => x.entityId) } } } });
  },
  COMPLAINTS_RESOLVED: (e, r) => prisma.supportTicket.count({ where: { assignedEmployeeId: e.id, status: { in: ['RESOLVED', 'CLOSED'] }, resolvedAt: r } }),
  AVG_RESOLUTION_HOURS: async (e, r) => {
    const t = await prisma.supportTicket.findMany({ where: { assignedEmployeeId: e.id, resolvedAt: r }, select: { createdAt: true, resolvedAt: true } });
    return t.length ? Math.round((t.reduce((n, x) => n + (x.resolvedAt!.getTime() - x.createdAt.getTime()), 0) / t.length / 3600_000) * 10) / 10 : 0;
  },
  DOCS_REVIEWED: (e, r) => prisma.verificationReview.count({ where: { reviewerId: e.userId, createdAt: r } }),
  APPROVALS: (e, r) => prisma.verificationReview.count({ where: { reviewerId: e.userId, createdAt: r, toStatus: { in: ['VERIFIED', 'APPROVED'] } } }),
  REJECTIONS: (e, r) => prisma.verificationReview.count({ where: { reviewerId: e.userId, createdAt: r, toStatus: 'REJECTED' } }),
  PENDING_VERIFICATION: async () => (await prisma.company.count({ where: { status: { in: ['PENDING_VERIFICATION', 'UNDER_REVIEW'] } } })) + (await prisma.kycDocument.count({ where: { status: 'UPLOADED', isCurrent: true } })),
};

function rangeFor(p: Period) {
  const ymd = todayIstStr();
  const today = istStart(ymd);
  const lte = new Date();
  const monthStart = istStart(`${ymd.slice(0, 7)}-01`);
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dayOfMonth = Number(ymd.slice(8));
  const dow = (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday start
  const gte = p === 'day' ? today : p === 'week' ? new Date(today.getTime() - dow * 86400_000) : monthStart;
  // Expected share of the monthly target by the end of today, for this period length.
  const share = p === 'month' ? dayOfMonth / daysInMonth : p === 'week' ? (dow + 1) / daysInMonth : 1 / daysInMonth;
  return { range: { gte, lte }, share };
}

const ratingOf = (score: number) => (score >= 90 ? 'Outstanding' : score >= 75 ? 'Good' : score >= 50 ? 'Average' : 'Needs improvement');

/** Scorecard from Admin-configured targets: an employee-specific target overrides the role's. */
export async function kpiRows(e: Emp, period: Period) {
  const { range, share } = rangeFor(period);
  const [defs, targets] = await Promise.all([
    prisma.kpiDefinition.findMany(),
    prisma.kpiTarget.findMany({ where: { OR: [{ employeeId: e.id }, { roleId: e.roleId, employeeId: null }] } }),
  ]);
  const chosen = new Map<string, (typeof targets)[number]>();
  for (const t of targets) if (t.employeeId || !chosen.has(t.kpiCode)) chosen.set(t.kpiCode, t);
  const rows = [];
  for (const [code, t] of chosen) {
    const def = defs.find((d) => d.code === code);
    if (!def || !ACTUALS[code]) continue;
    const actual = await ACTUALS[code](e, range);
    const monthly = t.monthlyTarget.toNumber();
    const expected = Math.round(monthly * share * 10) / 10;
    // Rate-style KPIs (lower is better) compare directly with the target and do not pro-rate.
    const achievement = def.higherIsBetter ? (expected > 0 ? (actual / expected) * 100 : 0) : actual <= monthly ? 100 : monthly > 0 && actual > 0 ? (monthly / actual) * 100 : 0;
    const capped = Math.min(120, Math.round(achievement * 10) / 10);
    rows.push({ code, kpi: def.name, category: def.category, actual, monthlyTarget: monthly, expected: def.higherIsBetter ? expected : monthly, achievement: capped, weight: t.weightage, weightedScore: Math.round(((Math.min(100, capped) * t.weightage) / 100) * 10) / 10, rating: ratingOf(capped) });
  }
  const totalWeight = rows.reduce((n, r) => n + r.weight, 0);
  const totalScore = totalWeight ? Math.round((rows.reduce((n, r) => n + r.weightedScore, 0) / totalWeight) * 1000) / 10 : 0;
  return { period, rows, totalWeight, totalScore, rating: rows.length ? ratingOf(totalScore) : 'No targets set' };
}
