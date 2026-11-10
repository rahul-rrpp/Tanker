import { Prisma, type BookingStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/errors';

/**
 * Reports & Analytics. Every figure is computed from the company's own database records at request time
 * (no cached or hard-coded numbers). All reports share one shape so the UI and the Excel/PDF exporters are
 * generic: summary cards + one chart + a data table.
 */

export type Format = 'number' | 'currency' | 'percent' | 'text' | 'date' | 'datetime' | 'km';

export interface ReportResult {
  key: ReportKey;
  title: string;
  description: string;
  range: { from: string; to: string };
  summary: { label: string; value: number | string | null; format: Format }[];
  chart: { type: 'bar' | 'line' | 'pie'; xKey: string; series: { key: string; label: string; format: Format }[]; data: Record<string, unknown>[] } | null;
  columns: { key: string; label: string; format: Format }[];
  rows: Record<string, unknown>[];
}

export const REPORTS = {
  'total-bookings': { title: 'Total Booking Report', description: 'Every booking created in the period with its status and commercials.' },
  'monthly-bookings': { title: 'Monthly Booking Report', description: 'Bookings created per month, with confirmed and cancelled counts.' },
  'route-wise': { title: 'Route-wise Booking Report', description: 'Bookings, completion and freight grouped by pickup and delivery city.' },
  'oil-type': { title: 'Oil Type-wise Booking Report', description: 'Bookings, quantity and freight by product.' },
  'capacity-wise': { title: 'Tanker Capacity-wise Booking Report', description: 'Bookings and freight by tanker capacity.' },
  'transporter-wise': { title: 'Transporter-wise Booking Report', description: 'Tankers allocated and agreed freight per transporter.' },
  'freight-comparison': { title: 'Freight Comparison Report', description: 'Suggested freight vs your offer vs the agreed freight for confirmed bookings.' },
  'monthly-expenditure': { title: 'Monthly Freight Expenditure', description: 'Agreed freight per month (by confirmation date), excluding cancelled bookings.' },
  payments: { title: 'Payment Report', description: 'All payment transactions in the period.' },
  'pending-payments': { title: 'Pending Payment Report', description: 'Bookings with an outstanding balance against issued invoices.' },
  'completed-trips': { title: 'Completed Trip Report', description: 'Trips delivered or completed in the period.' },
  'cancelled-bookings': { title: 'Cancelled Booking Report', description: 'Bookings cancelled in the period with reasons.' },
  'repeat-bookings': { title: 'Repeat Booking Report', description: 'Routes booked more than once and bookings created with Repeat Booking.' },
} as const;

export type ReportKey = keyof typeof REPORTS;
export const REPORT_KEYS = Object.keys(REPORTS) as ReportKey[];

const STATUS_LABEL: Record<BookingStatus, string> = {
  SEARCHING: 'Searching',
  OFFERS_RECEIVED: 'Offers received',
  NEGOTIATION: 'Negotiation',
  CONFIRMED: 'Confirmed',
  VEHICLE_ASSIGNED: 'Vehicle assigned',
  DRIVER_ASSIGNED: 'Driver assigned',
  LOADING: 'Loading',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  DISPUTED: 'Disputed',
};

const n = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : typeof v === 'number' ? v : v.toNumber());
const r2 = (v: number) => Math.round(v * 100) / 100;
const pct = (a: number, b: number) => (b ? r2((a / b) * 100) : 0);
const istMonth = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 7);
const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

function resolveRange(from?: string, to?: string) {
  const end = to ?? todayIst();
  const startDefault = new Date(`${end}T00:00:00Z`);
  startDefault.setUTCMonth(startDefault.getUTCMonth() - 11, 1);
  const start = from ?? startDefault.toISOString().slice(0, 10);
  if (start > end) throw AppError.badRequest('"From" date must be before "To" date');
  return { from: start, to: end, gte: new Date(`${start}T00:00:00+05:30`), lte: new Date(`${end}T23:59:59.999+05:30`) };
}

function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  const end = to.slice(0, 7);
  while (d.toISOString().slice(0, 7) <= end && out.length < 60) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

const bookingSelect = {
  id: true,
  bookingCode: true,
  createdAt: true,
  confirmedAt: true,
  cancelledAt: true,
  cancellationReason: true,
  status: true,
  paymentStatus: true,
  distanceKm: true,
  suggestedFreight: true,
  customerOffer: true,
  acceptedFreight: true,
  repeatedFromId: true,
  isDemo: true,
  product: { select: { name: true } },
  requirement: { select: { tankerCapacityKl: true, quantityKl: true, numberOfTankers: true } },
  locations: { select: { type: true, city: true } },
} satisfies Prisma.BookingSelect;
type B = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;
const city = (b: B, t: 'PICKUP' | 'DELIVERY') => b.locations.find((l) => l.type === t)?.city ?? 'Unknown';
const isConfirmed = (b: B) => b.acceptedFreight !== null && b.status !== 'CANCELLED';

function groupBy<T>(items: T[], key: (t: T) => string) {
  const m = new Map<string, T[]>();
  for (const it of items) m.set(key(it), [...(m.get(key(it)) ?? []), it]);
  return m;
}

function grouped(bookings: B[], key: (b: B) => string, label: string) {
  const rows = [...groupBy(bookings, key).entries()].map(([k, list]) => {
    const confirmed = list.filter(isConfirmed);
    const freight = confirmed.reduce((s, b) => s + n(b.acceptedFreight), 0);
    return {
      group: k,
      bookings: list.length,
      confirmed: confirmed.length,
      completed: list.filter((b) => b.status === 'COMPLETED' || b.status === 'DELIVERED').length,
      cancelled: list.filter((b) => b.status === 'CANCELLED').length,
      quantityKl: r2(list.reduce((s, b) => s + n(b.requirement?.quantityKl), 0)),
      freight: r2(freight),
      averageFreight: confirmed.length ? r2(freight / confirmed.length) : 0,
    };
  });
  rows.sort((a, b) => b.bookings - a.bookings || b.freight - a.freight);
  return {
    rows,
    columns: [
      { key: 'group', label, format: 'text' as Format },
      { key: 'bookings', label: 'Bookings', format: 'number' as Format },
      { key: 'confirmed', label: 'Confirmed', format: 'number' as Format },
      { key: 'completed', label: 'Completed', format: 'number' as Format },
      { key: 'cancelled', label: 'Cancelled', format: 'number' as Format },
      { key: 'quantityKl', label: 'Quantity (KL)', format: 'number' as Format },
      { key: 'freight', label: 'Agreed freight', format: 'currency' as Format },
      { key: 'averageFreight', label: 'Avg freight / booking', format: 'currency' as Format },
    ],
  };
}

export async function runReport(companyId: string, key: ReportKey, params: { from?: string; to?: string }): Promise<ReportResult> {
  if (!REPORTS[key]) throw AppError.notFound('Unknown report');
  const range = resolveRange(params.from, params.to);
  const base = { key, ...REPORTS[key], range: { from: range.from, to: range.to } };
  const created = { gte: range.gte, lte: range.lte };
  const bookings = () => prisma.booking.findMany({ where: { companyId, createdAt: created }, select: bookingSelect, orderBy: { createdAt: 'desc' }, take: 5000 });

  switch (key) {
    case 'total-bookings': {
      const list = await bookings();
      const confirmed = list.filter(isConfirmed);
      const byStatus = [...groupBy(list, (b) => b.status).entries()].map(([s, l]) => ({ status: STATUS_LABEL[s as BookingStatus], bookings: l.length }));
      return {
        ...base,
        summary: [
          { label: 'Total bookings', value: list.length, format: 'number' },
          { label: 'Confirmed or later', value: confirmed.length, format: 'number' },
          { label: 'Cancelled', value: list.filter((b) => b.status === 'CANCELLED').length, format: 'number' },
          { label: 'Agreed freight', value: r2(confirmed.reduce((s, b) => s + n(b.acceptedFreight), 0)), format: 'currency' },
        ],
        chart: { type: 'bar', xKey: 'status', series: [{ key: 'bookings', label: 'Bookings', format: 'number' }], data: byStatus },
        columns: [
          { key: 'bookingCode', label: 'Booking ID', format: 'text' },
          { key: 'createdAt', label: 'Date', format: 'date' },
          { key: 'route', label: 'Route', format: 'text' },
          { key: 'product', label: 'Oil type', format: 'text' },
          { key: 'capacity', label: 'Capacity', format: 'text' },
          { key: 'customerOffer', label: 'Customer offer', format: 'currency' },
          { key: 'acceptedFreight', label: 'Accepted price', format: 'currency' },
          { key: 'status', label: 'Status', format: 'text' },
        ],
        rows: list.map((b) => ({
          bookingId: b.id,
          bookingCode: b.bookingCode,
          createdAt: b.createdAt,
          route: `${city(b, 'PICKUP')} → ${city(b, 'DELIVERY')}`,
          product: b.product.name,
          capacity: `${n(b.requirement?.tankerCapacityKl)} KL x ${b.requirement?.numberOfTankers ?? 1}`,
          customerOffer: n(b.customerOffer),
          acceptedFreight: b.acceptedFreight ? n(b.acceptedFreight) : null,
          status: STATUS_LABEL[b.status],
          demo: b.isDemo,
        })),
      };
    }

    case 'monthly-bookings': {
      const list = await bookings();
      const by = groupBy(list, (b) => istMonth(b.createdAt));
      const rows = monthsBetween(range.from, range.to).map((m) => {
        const l = by.get(m) ?? [];
        return {
          month: m,
          bookings: l.length,
          confirmed: l.filter(isConfirmed).length,
          cancelled: l.filter((b) => b.status === 'CANCELLED').length,
          freight: r2(l.filter(isConfirmed).reduce((s, b) => s + n(b.acceptedFreight), 0)),
        };
      });
      const busiest = rows.reduce((a, b) => (b.bookings > a.bookings ? b : a), rows[0] ?? { month: '-', bookings: 0 });
      return {
        ...base,
        summary: [
          { label: 'Bookings', value: list.length, format: 'number' },
          { label: 'Monthly average', value: rows.length ? r2(list.length / rows.length) : 0, format: 'number' },
          { label: 'Busiest month', value: busiest.bookings ? busiest.month : '-', format: 'text' },
          { label: 'Confirmation rate', value: pct(list.filter(isConfirmed).length, list.length), format: 'percent' },
        ],
        chart: { type: 'line', xKey: 'month', series: [{ key: 'bookings', label: 'Bookings', format: 'number' }], data: rows },
        columns: [
          { key: 'month', label: 'Month', format: 'text' },
          { key: 'bookings', label: 'Bookings', format: 'number' },
          { key: 'confirmed', label: 'Confirmed', format: 'number' },
          { key: 'cancelled', label: 'Cancelled', format: 'number' },
          { key: 'freight', label: 'Agreed freight', format: 'currency' },
        ],
        rows,
      };
    }

    case 'route-wise':
    case 'oil-type':
    case 'capacity-wise': {
      const list = await bookings();
      const keyFn =
        key === 'route-wise' ? (b: B) => `${city(b, 'PICKUP')} → ${city(b, 'DELIVERY')}` : key === 'oil-type' ? (b: B) => b.product.name : (b: B) => `${n(b.requirement?.tankerCapacityKl)} KL`;
      const label = key === 'route-wise' ? 'Route' : key === 'oil-type' ? 'Oil type' : 'Tanker capacity';
      const g = grouped(list, keyFn, label);
      return {
        ...base,
        summary: [
          { label: `${label}s`, value: g.rows.length, format: 'number' },
          { label: 'Bookings', value: list.length, format: 'number' },
          { label: `Top ${label.toLowerCase()}`, value: g.rows[0]?.group ?? '-', format: 'text' },
          { label: 'Agreed freight', value: r2(g.rows.reduce((s, r) => s + r.freight, 0)), format: 'currency' },
        ],
        chart: { type: key === 'route-wise' ? 'bar' : 'pie', xKey: 'group', series: [{ key: 'bookings', label: 'Bookings', format: 'number' }], data: g.rows.slice(0, 10) },
        columns: g.columns,
        rows: g.rows,
      };
    }

    case 'transporter-wise': {
      const allocs = await prisma.bookingAllocation.findMany({
        where: { booking: { companyId, createdAt: created }, status: { not: 'CANCELLED' } },
        select: { tankersAllocated: true, agreedFreight: true, status: true, bookingId: true, transporter: { select: { companyName: true, rating: true, isDemo: true } } },
      });
      const rows = [...groupBy(allocs, (a) => a.transporter.companyName).entries()]
        .map(([name, l]) => ({
          group: name,
          bookings: new Set(l.map((a) => a.bookingId)).size,
          tankers: l.reduce((s, a) => s + a.tankersAllocated, 0),
          completed: l.filter((a) => a.status === 'COMPLETED').length,
          freight: r2(l.reduce((s, a) => s + n(a.agreedFreight), 0)),
          rating: n(l[0].transporter.rating),
          demo: l[0].transporter.isDemo,
        }))
        .sort((a, b) => b.freight - a.freight);
      const total = rows.reduce((s, r) => s + r.freight, 0);
      return {
        ...base,
        summary: [
          { label: 'Transporters used', value: rows.length, format: 'number' },
          { label: 'Tankers allocated', value: rows.reduce((s, r) => s + r.tankers, 0), format: 'number' },
          { label: 'Top transporter', value: rows[0]?.group ?? '-', format: 'text' },
          { label: 'Agreed freight', value: r2(total), format: 'currency' },
        ],
        chart: { type: 'bar', xKey: 'group', series: [{ key: 'freight', label: 'Agreed freight', format: 'currency' }], data: rows.slice(0, 10) },
        columns: [
          { key: 'group', label: 'Transporter', format: 'text' },
          { key: 'bookings', label: 'Bookings', format: 'number' },
          { key: 'tankers', label: 'Tankers', format: 'number' },
          { key: 'completed', label: 'Allocations completed', format: 'number' },
          { key: 'rating', label: 'Rating', format: 'number' },
          { key: 'freight', label: 'Agreed freight', format: 'currency' },
        ],
        rows: rows.map((r) => ({ ...r, share: pct(r.freight, total) })),
      };
    }

    case 'freight-comparison': {
      const list = (await bookings()).filter(isConfirmed);
      const rows = list.map((b) => {
        const s = n(b.suggestedFreight);
        const o = n(b.customerOffer);
        const a = n(b.acceptedFreight);
        return {
          bookingId: b.id,
          bookingCode: b.bookingCode,
          route: `${city(b, 'PICKUP')} → ${city(b, 'DELIVERY')}`,
          distanceKm: n(b.distanceKm),
          suggested: s,
          offer: o,
          accepted: a,
          vsSuggested: pct(a - s, s),
          vsOffer: pct(a - o, o),
          demo: b.isDemo,
        };
      });
      const sum = (k: 'suggested' | 'offer' | 'accepted') => rows.reduce((t, r) => t + r[k], 0);
      return {
        ...base,
        summary: [
          { label: 'Confirmed bookings', value: rows.length, format: 'number' },
          { label: 'Total suggested', value: r2(sum('suggested')), format: 'currency' },
          { label: 'Total agreed', value: r2(sum('accepted')), format: 'currency' },
          { label: 'Agreed vs suggested', value: pct(sum('accepted') - sum('suggested'), sum('suggested')), format: 'percent' },
        ],
        chart: {
          type: 'bar',
          xKey: 'bookingCode',
          series: [
            { key: 'suggested', label: 'Suggested', format: 'currency' },
            { key: 'offer', label: 'Your offer', format: 'currency' },
            { key: 'accepted', label: 'Agreed', format: 'currency' },
          ],
          data: rows.slice(0, 12).reverse(),
        },
        columns: [
          { key: 'bookingCode', label: 'Booking ID', format: 'text' },
          { key: 'route', label: 'Route', format: 'text' },
          { key: 'distanceKm', label: 'Distance', format: 'km' },
          { key: 'suggested', label: 'Suggested', format: 'currency' },
          { key: 'offer', label: 'Your offer', format: 'currency' },
          { key: 'accepted', label: 'Agreed', format: 'currency' },
          { key: 'vsSuggested', label: 'Agreed vs suggested', format: 'percent' },
          { key: 'vsOffer', label: 'Agreed vs offer', format: 'percent' },
        ],
        rows,
      };
    }

    case 'monthly-expenditure': {
      const list = await prisma.booking.findMany({
        where: { companyId, acceptedFreight: { not: null }, status: { not: 'CANCELLED' }, confirmedAt: created },
        select: bookingSelect,
      });
      const by = groupBy(list, (b) => istMonth(b.confirmedAt!));
      const rows = monthsBetween(range.from, range.to).map((m) => {
        const l = by.get(m) ?? [];
        const spend = l.reduce((s, b) => s + n(b.acceptedFreight), 0);
        return { month: m, trips: l.length, spend: r2(spend), averageFreight: l.length ? r2(spend / l.length) : 0 };
      });
      const total = rows.reduce((s, r) => s + r.spend, 0);
      return {
        ...base,
        summary: [
          { label: 'Total expenditure', value: r2(total), format: 'currency' },
          { label: 'Monthly average', value: rows.length ? r2(total / rows.length) : 0, format: 'currency' },
          { label: 'Confirmed bookings', value: list.length, format: 'number' },
          { label: 'Average per booking', value: list.length ? r2(total / list.length) : 0, format: 'currency' },
        ],
        chart: { type: 'bar', xKey: 'month', series: [{ key: 'spend', label: 'Freight expenditure', format: 'currency' }], data: rows },
        columns: [
          { key: 'month', label: 'Month', format: 'text' },
          { key: 'trips', label: 'Confirmed bookings', format: 'number' },
          { key: 'spend', label: 'Freight expenditure', format: 'currency' },
          { key: 'averageFreight', label: 'Average per booking', format: 'currency' },
        ],
        rows,
      };
    }

    case 'payments': {
      const list = await prisma.payment.findMany({
        where: { companyId, createdAt: created },
        orderBy: { createdAt: 'desc' },
        select: { id: true, receiptNumber: true, purpose: true, amount: true, status: true, method: true, provider: true, paidAt: true, createdAt: true, failureReason: true, booking: { select: { id: true, bookingCode: true } } },
      });
      const sum = (s: string) => r2(list.filter((p) => p.status === s).reduce((t, p) => t + n(p.amount), 0));
      const byMethod = [...groupBy(list.filter((p) => p.status === 'PAID'), (p) => p.method ?? 'OTHER').entries()].map(([m, l]) => ({ method: m.replace('_', ' '), amount: r2(l.reduce((t, p) => t + n(p.amount), 0)) }));
      return {
        ...base,
        summary: [
          { label: 'Amount paid', value: sum('PAID'), format: 'currency' },
          { label: 'Successful payments', value: list.filter((p) => p.status === 'PAID').length, format: 'number' },
          { label: 'Failed attempts', value: list.filter((p) => p.status === 'FAILED').length, format: 'number' },
          { label: 'Refunds (pending + done)', value: r2(sum('REFUND_PENDING') + sum('REFUNDED')), format: 'currency' },
        ],
        chart: { type: 'pie', xKey: 'method', series: [{ key: 'amount', label: 'Amount paid', format: 'currency' }], data: byMethod },
        columns: [
          { key: 'date', label: 'Date', format: 'datetime' },
          { key: 'bookingCode', label: 'Booking ID', format: 'text' },
          { key: 'purpose', label: 'Purpose', format: 'text' },
          { key: 'method', label: 'Method', format: 'text' },
          { key: 'amount', label: 'Amount', format: 'currency' },
          { key: 'status', label: 'Status', format: 'text' },
          { key: 'receiptNumber', label: 'Receipt', format: 'text' },
        ],
        rows: list.map((p) => ({
          paymentId: p.id,
          bookingId: p.booking.id,
          date: p.paidAt ?? p.createdAt,
          bookingCode: p.booking.bookingCode,
          purpose: p.purpose,
          method: p.method ?? '-',
          amount: n(p.amount),
          status: p.status,
          receiptNumber: p.receiptNumber ?? '-',
          demo: p.provider === 'MOCK',
        })),
      };
    }

    case 'pending-payments': {
      const invoices = await prisma.invoice.findMany({
        where: { companyId, status: { not: 'CANCELLED' }, issuedAt: created, booking: { status: { not: 'CANCELLED' } } },
        select: { bookingId: true, totalAmount: true, dueAt: true, booking: { select: bookingSelect } },
      });
      const paid = await prisma.payment.groupBy({ by: ['bookingId'], where: { companyId, status: 'PAID' }, _sum: { amount: true } });
      const paidBy = new Map(paid.map((p) => [p.bookingId, n(p._sum.amount)]));
      const rows = [...groupBy(invoices, (i) => i.bookingId).entries()]
        .map(([id, l]) => {
          const b = l[0].booking;
          const total = l.reduce((s, i) => s + n(i.totalAmount), 0);
          const p = paidBy.get(id) ?? 0;
          const dueAt = l.reduce<Date | null>((m, i) => (i.dueAt && (!m || i.dueAt < m) ? i.dueAt : m), null);
          return {
            bookingId: id,
            bookingCode: b.bookingCode,
            route: `${city(b, 'PICKUP')} → ${city(b, 'DELIVERY')}`,
            total: r2(total),
            paid: r2(p),
            due: r2(total - p),
            dueAt,
            overdueDays: dueAt && dueAt.getTime() < Date.now() ? Math.floor((Date.now() - dueAt.getTime()) / 86400_000) : 0,
            paymentStatus: b.paymentStatus,
            demo: b.isDemo,
          };
        })
        .filter((r) => r.due > 0.009)
        .sort((a, b) => b.due - a.due);
      const due = rows.reduce((s, r) => s + r.due, 0);
      return {
        ...base,
        summary: [
          { label: 'Outstanding amount', value: r2(due), format: 'currency' },
          { label: 'Bookings with dues', value: rows.length, format: 'number' },
          { label: 'Overdue bookings', value: rows.filter((r) => r.overdueDays > 0).length, format: 'number' },
          { label: 'Largest due', value: rows[0]?.due ?? 0, format: 'currency' },
        ],
        chart: { type: 'bar', xKey: 'bookingCode', series: [{ key: 'due', label: 'Amount due', format: 'currency' }], data: rows.slice(0, 12) },
        columns: [
          { key: 'bookingCode', label: 'Booking ID', format: 'text' },
          { key: 'route', label: 'Route', format: 'text' },
          { key: 'total', label: 'Invoiced', format: 'currency' },
          { key: 'paid', label: 'Paid', format: 'currency' },
          { key: 'due', label: 'Due', format: 'currency' },
          { key: 'dueAt', label: 'Due date', format: 'date' },
          { key: 'overdueDays', label: 'Days overdue', format: 'number' },
          { key: 'paymentStatus', label: 'Payment status', format: 'text' },
        ],
        rows,
      };
    }

    case 'completed-trips': {
      const trips = await prisma.trip.findMany({
        where: { booking: { companyId }, status: { in: ['DELIVERED', 'COMPLETED'] }, deliveredAt: created },
        orderBy: { deliveredAt: 'desc' },
        select: {
          tripCode: true,
          status: true,
          plannedDistanceKm: true,
          startedAt: true,
          deliveredAt: true,
          isSimulated: true,
          booking: { select: { id: true, bookingCode: true, expectedDeliveryDate: true, product: { select: { name: true } }, locations: { select: { type: true, city: true } } } },
          transporter: { select: { companyName: true } },
          tanker: { select: { registrationNumber: true } },
          driver: { select: { user: { select: { fullName: true } } } },
          allocation: { select: { agreedFreight: true, tankersAllocated: true } },
        },
      });
      const rows = trips.map((t) => {
        const onTime = t.deliveredAt && t.booking.expectedDeliveryDate ? t.deliveredAt.getTime() <= t.booking.expectedDeliveryDate.getTime() + 86400_000 + 5.5 * 3600_000 : null;
        return {
          bookingId: t.booking.id,
          tripCode: t.tripCode,
          bookingCode: t.booking.bookingCode,
          route: `${t.booking.locations.find((l) => l.type === 'PICKUP')?.city ?? '-'} → ${t.booking.locations.find((l) => l.type === 'DELIVERY')?.city ?? '-'}`,
          product: t.booking.product.name,
          transporter: t.transporter.companyName,
          tanker: t.tanker?.registrationNumber ?? '-',
          driver: t.driver?.user.fullName ?? '-',
          distanceKm: n(t.plannedDistanceKm),
          deliveredAt: t.deliveredAt,
          onTime: onTime === null ? '-' : onTime ? 'Yes' : 'No',
          freight: r2(n(t.allocation.agreedFreight) / Math.max(1, t.allocation.tankersAllocated)),
          demo: t.isSimulated,
        };
      });
      const byMonth = groupBy(rows, (r) => istMonth(r.deliveredAt!));
      return {
        ...base,
        summary: [
          { label: 'Completed trips', value: rows.length, format: 'number' },
          { label: 'Distance covered', value: r2(rows.reduce((s, r) => s + r.distanceKm, 0)), format: 'km' },
          { label: 'On-time delivery', value: pct(rows.filter((r) => r.onTime === 'Yes').length, rows.filter((r) => r.onTime !== '-').length), format: 'percent' },
          { label: 'Freight (per trip share)', value: r2(rows.reduce((s, r) => s + r.freight, 0)), format: 'currency' },
        ],
        chart: { type: 'bar', xKey: 'month', series: [{ key: 'trips', label: 'Trips', format: 'number' }], data: monthsBetween(range.from, range.to).map((m) => ({ month: m, trips: byMonth.get(m)?.length ?? 0 })) },
        columns: [
          { key: 'tripCode', label: 'Trip', format: 'text' },
          { key: 'bookingCode', label: 'Booking ID', format: 'text' },
          { key: 'route', label: 'Route', format: 'text' },
          { key: 'transporter', label: 'Transporter', format: 'text' },
          { key: 'tanker', label: 'Tanker', format: 'text' },
          { key: 'driver', label: 'Driver', format: 'text' },
          { key: 'distanceKm', label: 'Distance', format: 'km' },
          { key: 'deliveredAt', label: 'Delivered', format: 'datetime' },
          { key: 'onTime', label: 'On time', format: 'text' },
        ],
        rows,
      };
    }

    case 'cancelled-bookings': {
      const list = await prisma.booking.findMany({ where: { companyId, status: 'CANCELLED', cancelledAt: created }, select: bookingSelect, orderBy: { cancelledAt: 'desc' } });
      const all = await prisma.booking.count({ where: { companyId, createdAt: created } });
      const byReason = [...groupBy(list, (b) => b.cancellationReason ?? 'Not specified').entries()].map(([reason, l]) => ({ reason, bookings: l.length })).sort((a, b) => b.bookings - a.bookings);
      return {
        ...base,
        summary: [
          { label: 'Cancelled bookings', value: list.length, format: 'number' },
          { label: 'Cancellation rate', value: pct(list.length, all), format: 'percent' },
          { label: 'Cancelled after confirmation', value: list.filter((b) => b.confirmedAt).length, format: 'number' },
          { label: 'Refunds pending', value: list.filter((b) => b.paymentStatus === 'REFUND_PENDING').length, format: 'number' },
        ],
        chart: { type: 'bar', xKey: 'reason', series: [{ key: 'bookings', label: 'Bookings', format: 'number' }], data: byReason.slice(0, 8) },
        columns: [
          { key: 'bookingCode', label: 'Booking ID', format: 'text' },
          { key: 'createdAt', label: 'Booked on', format: 'date' },
          { key: 'cancelledAt', label: 'Cancelled on', format: 'datetime' },
          { key: 'route', label: 'Route', format: 'text' },
          { key: 'product', label: 'Oil type', format: 'text' },
          { key: 'reason', label: 'Reason', format: 'text' },
          { key: 'paymentStatus', label: 'Payment status', format: 'text' },
        ],
        rows: list.map((b) => ({
          bookingId: b.id,
          bookingCode: b.bookingCode,
          createdAt: b.createdAt,
          cancelledAt: b.cancelledAt,
          route: `${city(b, 'PICKUP')} → ${city(b, 'DELIVERY')}`,
          product: b.product.name,
          reason: b.cancellationReason ?? '-',
          paymentStatus: b.paymentStatus,
          demo: b.isDemo,
        })),
      };
    }

    case 'repeat-bookings': {
      const list = await bookings();
      const routes = [...groupBy(list, (b) => `${city(b, 'PICKUP')} → ${city(b, 'DELIVERY')}`).entries()]
        .filter(([, l]) => l.length > 1)
        .map(([route, l]) => {
          const confirmed = l.filter(isConfirmed);
          const sorted = [...l].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return {
            group: route,
            bookings: l.length,
            viaRepeat: l.filter((b) => b.repeatedFromId).length,
            averageFreight: confirmed.length ? r2(confirmed.reduce((s, b) => s + n(b.acceptedFreight), 0) / confirmed.length) : 0,
            lastBooked: sorted[0].createdAt,
            lastBookingId: sorted[0].id,
          };
        })
        .sort((a, b) => b.bookings - a.bookings);
      const repeatCount = list.filter((b) => b.repeatedFromId).length;
      return {
        ...base,
        summary: [
          { label: 'Repeated routes', value: routes.length, format: 'number' },
          { label: 'Bookings on repeated routes', value: routes.reduce((s, r) => s + r.bookings, 0), format: 'number' },
          { label: 'Created with Repeat Booking', value: repeatCount, format: 'number' },
          { label: 'Repeat share', value: pct(routes.reduce((s, r) => s + r.bookings, 0), list.length), format: 'percent' },
        ],
        chart: { type: 'bar', xKey: 'group', series: [{ key: 'bookings', label: 'Bookings', format: 'number' }], data: routes.slice(0, 10) },
        columns: [
          { key: 'group', label: 'Route', format: 'text' },
          { key: 'bookings', label: 'Bookings', format: 'number' },
          { key: 'viaRepeat', label: 'Via Repeat Booking', format: 'number' },
          { key: 'averageFreight', label: 'Avg agreed freight', format: 'currency' },
          { key: 'lastBooked', label: 'Last booked', format: 'date' },
        ],
        rows: routes,
      };
    }
  }
}
