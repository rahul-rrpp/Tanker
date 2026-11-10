import { Prisma } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { ok } from '../../utils/response';
import { adminAuth, can } from './core';
import { ensureCommissions } from './commission.service';

/**
 * Executive dashboard. Every figure is a live database aggregate for the selected period; state KPIs
 * (registered companies, active trips, outstanding...) are point-in-time.
 */
export const adminDashboardRouter = Router();
adminDashboardRouter.use(...adminAuth, can('dashboard', 'view'));

const IST = 5.5 * 3600_000;
const istDay = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);

export function periodRange(range: string, from?: string, to?: string): { gte: Date; lte: Date; label: string } {
  const todayIst = istDay(new Date());
  const startOf = (iso: string) => new Date(`${iso}T00:00:00+05:30`);
  const endOf = (iso: string) => new Date(`${iso}T23:59:59.999+05:30`);
  const shift = (iso: string, days: number) => istDay(new Date(startOf(iso).getTime() + days * 86400_000 + IST));
  const [y, m] = todayIst.split('-').map(Number);
  switch (range) {
    case 'today':
      return { gte: startOf(todayIst), lte: endOf(todayIst), label: 'Today' };
    case 'yesterday': {
      const d = shift(todayIst, -1);
      return { gte: startOf(d), lte: endOf(d), label: 'Yesterday' };
    }
    case '7d':
      return { gte: startOf(shift(todayIst, -6)), lte: endOf(todayIst), label: 'Last 7 days' };
    case 'month':
      return { gte: startOf(`${todayIst.slice(0, 7)}-01`), lte: endOf(todayIst), label: 'This month' };
    case 'lastmonth': {
      const first = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
      const last = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
      return { gte: startOf(first), lte: endOf(last), label: 'Last month' };
    }
    case 'quarter': {
      const qStartMonth = Math.floor((m - 1) / 3) * 3;
      return { gte: startOf(new Date(Date.UTC(y, qStartMonth, 1)).toISOString().slice(0, 10)), lte: endOf(todayIst), label: 'This quarter' };
    }
    case 'custom':
      if (from && to) return { gte: startOf(from), lte: endOf(to), label: `${from} to ${to}` };
      return { gte: startOf(shift(todayIst, -29)), lte: endOf(todayIst), label: 'Last 30 days' };
    default:
      return { gte: startOf(shift(todayIst, -29)), lte: endOf(todayIst), label: 'Last 30 days' };
  }
}

const n = (v: Prisma.Decimal | number | bigint | null | undefined) => (v === null || v === undefined ? 0 : typeof v === 'object' ? v.toNumber() : Number(v));

adminDashboardRouter.get('/', async (req: Request, res: Response) => {
  const q = z
    .object({ range: z.enum(['today', 'yesterday', '7d', 'month', 'lastmonth', 'quarter', 'custom', '30d']).default('30d'), from: z.string().optional(), to: z.string().optional() })
    .parse(req.query);
  const r = periodRange(q.range, q.from, q.to);
  const inRange = { gte: r.gte, lte: r.lte };
  await ensureCommissions();

  const [
    companies, companiesVerified, companiesPending, transporters, transportersVerified, drivers, tankers, tankersAvailable,
    bookingsInRange, pendingBookings, activeTrips, completedTrips, cancelled, freight, commission, invoices, paid, pendingSettlement, openComplaints,
  ] = await Promise.all([
    prisma.company.count(),
    prisma.company.count({ where: { status: 'VERIFIED' } }),
    prisma.company.count({ where: { status: { in: ['PENDING_VERIFICATION', 'UNDER_REVIEW'] } } }),
    prisma.agency.count(),
    prisma.agency.count({ where: { verificationStatus: 'APPROVED' } }),
    prisma.driver.count(),
    prisma.tanker.count(),
    prisma.tanker.count({ where: { status: 'AVAILABLE' } }),
    prisma.booking.count({ where: { createdAt: inRange } }),
    prisma.booking.count({ where: { status: { in: ['SEARCHING', 'OFFERS_RECEIVED', 'NEGOTIATION'] } } }),
    prisma.trip.count({ where: { status: { notIn: ['COMPLETED', 'CANCELLED', 'DELIVERED', 'SCHEDULED'] } } }),
    prisma.trip.count({ where: { status: { in: ['DELIVERED', 'COMPLETED'] }, deliveredAt: inRange } }),
    prisma.booking.count({ where: { status: 'CANCELLED', cancelledAt: inRange } }),
    prisma.booking.aggregate({ where: { acceptedFreight: { not: null }, status: { not: 'CANCELLED' }, confirmedAt: inRange }, _sum: { acceptedFreight: true } }),
    prisma.bookingCommission.aggregate({ where: { computedAt: inRange }, _sum: { commissionAmount: true } }),
    prisma.invoice.aggregate({ where: { status: { not: 'CANCELLED' } }, _sum: { totalAmount: true } }),
    prisma.payment.aggregate({ where: { status: 'PAID' }, _sum: { amount: true } }),
    prisma.settlement.aggregate({ where: { status: { in: ['PENDING', 'ON_HOLD'] } }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.supportTicket.count({ where: { status: { notIn: ['RESOLVED', 'CLOSED'] } } }),
  ]);

  // Daily trend over the selected period (max 92 days), monthly trends over 12 months.
  const days: string[] = [];
  for (let t = r.gte.getTime(); t <= r.lte.getTime() && days.length < 92; t += 86400_000) days.push(istDay(new Date(t)));
  type Row = { k: string; c: bigint; v: Prisma.Decimal | null };
  const daily = await prisma.$queryRaw<Row[]>`
    SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') k, COUNT(*) c, SUM("acceptedFreight") v
      FROM bookings WHERE "createdAt" BETWEEN ${r.gte} AND ${r.lte} GROUP BY 1`;
  const monthly = (table: 'bookings' | 'companies' | 'transporters') =>
    prisma.$queryRawUnsafe<Row[]>(
      `SELECT to_char(date_trunc('month', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') k, COUNT(*) c, NULL::numeric v
         FROM ${table === 'transporters' ? '"Agency"' : table} WHERE "createdAt" >= now() - interval '12 months' GROUP BY 1`,
    );
  const [mBookings, mCompanies, mTransporters] = await Promise.all([monthly('bookings'), monthly('companies'), monthly('transporters')]);
  const revenueRows = await prisma.$queryRaw<{ k: string; commission: Prisma.Decimal | null }[]>`
    SELECT to_char(date_trunc('month', ("computedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') k, SUM("commissionAmount") commission
      FROM booking_commissions WHERE "computedAt" >= now() - interval '12 months' GROUP BY 1`;
  const subRev = await prisma.$queryRaw<{ k: string; v: Prisma.Decimal | null }[]>`
    SELECT to_char(date_trunc('month', ("startAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') k, SUM(amount) v
      FROM subscriptions WHERE "startAt" >= now() - interval '12 months' AND status <> 'CANCELLED' GROUP BY 1`;
  const svcRev = await prisma.$queryRaw<{ k: string; v: Prisma.Decimal | null }[]>`
    SELECT to_char(date_trunc('month', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') k, SUM("totalAmount" - "taxAmount" - "costAmount") v
      FROM service_orders WHERE "createdAt" >= now() - interval '12 months' AND status IN ('CONFIRMED','FULFILLED') GROUP BY 1`;

  const months: string[] = [];
  const now = new Date(Date.now() + IST);
  for (let i = 11; i >= 0; i--) months.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const mapOf = (rows: Row[]) => new Map(rows.map((x) => [x.k, n(x.c)]));
  const mb = mapOf(mBookings);
  const mc = mapOf(mCompanies);
  const mt = mapOf(mTransporters);
  const rev = new Map(revenueRows.map((x) => [x.k, n(x.commission)]));
  const sub = new Map(subRev.map((x) => [x.k, n(x.v)]));
  const svc = new Map(svcRev.map((x) => [x.k, n(x.v)]));
  const dmap = new Map(daily.map((x) => [x.k, n(x.c)]));

  const funnelBase = { createdAt: inRange };
  const [fCreated, fOffers, fConfirmed, fCompleted] = await Promise.all([
    prisma.booking.count({ where: funnelBase }),
    prisma.booking.count({ where: { ...funnelBase, offers: { some: {} } } }),
    prisma.booking.count({ where: { ...funnelBase, acceptedFreight: { not: null } } }),
    prisma.booking.count({ where: { ...funnelBase, status: { in: ['DELIVERED', 'COMPLETED'] } } }),
  ]);

  // The arrow is added in JS: databases created with a non-UTF8 encoding (e.g. WIN1252) cannot hold it.
  const routeRows = await prisma.$queryRaw<{ pickup: string | null; delivery: string | null; c: bigint }[]>`
    SELECT p.city pickup, d.city delivery, COUNT(*) c FROM bookings b
      JOIN booking_locations p ON p."bookingId" = b.id AND p.type = 'PICKUP'
      JOIN booking_locations d ON d."bookingId" = b.id AND d.type = 'DELIVERY'
     WHERE b."createdAt" BETWEEN ${r.gte} AND ${r.lte} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 8`;
  const routes = routeRows.map((x) => ({ route: x.pickup && x.delivery ? `${x.pickup} → ${x.delivery}` : null, c: x.c }));
  const capacity = await prisma.$queryRaw<{ cap: Prisma.Decimal; c: bigint }[]>`
    SELECT r."tankerCapacityKl" cap, SUM(r."numberOfTankers") c FROM booking_requirements r JOIN bookings b ON b.id = r."bookingId"
     WHERE b."createdAt" BETWEEN ${r.gte} AND ${r.lte} GROUP BY 1 ORDER BY 1`;
  const statuses = await prisma.booking.groupBy({ by: ['status'], where: { createdAt: inRange }, _count: { _all: true } });

  // Employee performance in period: leads converted, bookings created on behalf, complaints resolved, reviews done.
  const employees = await prisma.employee.findMany({ where: { employmentStatus: 'ACTIVE' }, select: { id: true, userId: true, user: { select: { fullName: true } }, role: { select: { name: true } } } });
  const perf = await Promise.all(
    employees.map(async (e) => {
      const [converted, bookingsAssisted, resolved, reviews] = await Promise.all([
        prisma.lead.count({ where: { assignedEmployeeId: e.id, convertedAt: inRange } }),
        prisma.booking.count({ where: { createdById: e.userId, source: 'ADMIN_ASSISTED', createdAt: inRange } }),
        prisma.supportTicket.count({ where: { assignedEmployeeId: e.id, status: { in: ['RESOLVED', 'CLOSED'] }, resolvedAt: inRange } }),
        prisma.verificationReview.count({ where: { reviewerId: e.userId, createdAt: inRange } }),
      ]);
      return { employee: e.user.fullName, role: e.role.name, converted, bookingsAssisted, resolved, reviews, total: converted + bookingsAssisted + resolved + reviews };
    }),
  );

  ok(res, 'Admin dashboard', {
    period: { range: q.range, label: r.label, from: istDay(r.gte), to: istDay(r.lte) },
    kpis: {
      totalCompanies: companies,
      verifiedCompanies: companiesVerified,
      pendingCompanyVerification: companiesPending,
      totalTransporters: transporters,
      verifiedTransporters: transportersVerified,
      totalDrivers: drivers,
      totalTankers: tankers,
      availableTankers: tankersAvailable,
      totalBookings: bookingsInRange,
      pendingBookings,
      activeTrips,
      completedTrips,
      cancelledBookings: cancelled,
      freightBookingValue: n(freight._sum.acceptedFreight),
      commissionRevenue: n(commission._sum.commissionAmount),
      outstandingPayments: Math.max(0, n(invoices._sum.totalAmount) - n(paid._sum.amount)),
      pendingSettlements: n(pendingSettlement._sum.amount),
      pendingSettlementCount: pendingSettlement._count._all,
      openComplaints,
    },
    charts: {
      dailyBookings: days.map((d) => ({ day: d, bookings: dmap.get(d) ?? 0 })),
      monthlyBookings: months.map((m) => ({ month: m, bookings: mb.get(m) ?? 0 })),
      companyGrowth: months.map((m) => ({ month: m, registrations: mc.get(m) ?? 0 })),
      transporterGrowth: months.map((m) => ({ month: m, registrations: mt.get(m) ?? 0 })),
      funnel: [
        { stage: 'Booking requests', value: fCreated },
        { stage: 'Received offers', value: fOffers },
        { stage: 'Confirmed', value: fConfirmed },
        { stage: 'Delivered / completed', value: fCompleted },
      ],
      revenue: months.map((m) => ({ month: m, commission: rev.get(m) ?? 0, subscriptions: sub.get(m) ?? 0, services: svc.get(m) ?? 0 })),
      routes: routes.map((x) => ({ route: x.route ?? 'Unknown', bookings: n(x.c) })),
      capacity: capacity.map((x) => ({ capacity: `${n(x.cap)} KL`, tankers: n(x.c) })),
      statuses: statuses.map((s) => ({ status: s.status, bookings: s._count._all })).sort((a, b) => b.bookings - a.bookings),
      employeePerformance: perf.sort((a, b) => b.total - a.total).slice(0, 10),
    },
  });
});
