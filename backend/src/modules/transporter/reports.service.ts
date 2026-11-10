import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/errors';
import { ACTIVE_TRIP } from '../trips/trip.service';

/** All 27 transporter reports, computed on request from this transporter's own records. */

type Format = 'number' | 'currency' | 'percent' | 'km' | 'date' | 'datetime' | 'text';
type Col = { key: string; label: string; format: Format };
type Row = Record<string, unknown>;

const c = (key: string, label: string, format: Format = 'text'): Col => ({ key, label, format });
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

function range(p: { from?: string; to?: string }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const to = p.to ?? today;
  const from = p.from ?? new Date(new Date(`${to}T00:00:00Z`).getTime() - 365 * 86400_000).toISOString().slice(0, 10);
  return { from, to, gte: new Date(`${from}T00:00:00+05:30`), lte: new Date(`${to}T23:59:59.999+05:30`) };
}

const REPORTS = {
  'total-tankers': ['Total Tankers', 'Fleet'], 'available-tankers': ['Available Tankers', 'Fleet'], 'tanker-utilization': ['Tanker Utilization', 'Fleet'], 'tanker-trip-history': ['Tanker-wise Trip History', 'Fleet'], 'maintenance-status': ['Maintenance Status', 'Fleet'], 'document-expiry': ['Document Expiry Report', 'Fleet'],
  'booking-requests': ['Booking Requests Received', 'Bookings'], 'offers-submitted': ['Offers Submitted', 'Bookings'], 'offers-accepted': ['Offers Accepted', 'Bookings'], 'offers-rejected': ['Offers Rejected', 'Bookings'], 'offer-conversion': ['Offer Conversion Rate', 'Bookings'], 'confirmed-bookings': ['Confirmed Bookings', 'Bookings'], 'cancelled-bookings': ['Cancelled Bookings', 'Bookings'],
  'active-trips': ['Active Trips', 'Trips'], 'completed-trips': ['Completed Trips', 'Trips'], 'delayed-trips': ['Delayed Trips', 'Trips'], 'route-trips': ['Route-wise Trips', 'Trips'], 'driver-trips': ['Driver-wise Trips', 'Trips'],
  'monthly-earnings': ['Monthly Freight Earnings', 'Financial'], 'booking-earnings': ['Booking-wise Earnings', 'Financial'], 'commission-deductions': ['Commission Deductions', 'Financial'], 'pending-settlements': ['Pending Settlements', 'Financial'], 'completed-settlements': ['Completed Settlements', 'Financial'],
  'acceptance-rate': ['Acceptance Rate', 'Performance'], 'trip-completion-rate': ['Trip Completion Rate', 'Performance'], 'cancellation-rate': ['Cancellation Rate', 'Performance'], 'customer-rating': ['Average Customer Rating', 'Performance'],
} as const;
type Key = keyof typeof REPORTS;

export const REPORT_LIST = (Object.entries(REPORTS) as [Key, readonly [string, string]][]).map(([key, [title, group]]) => ({ key, title, group }));

const route = (ls: { type: string; city: string | null }[]) => `${ls.find((l) => l.type === 'PICKUP')?.city ?? '?'} → ${ls.find((l) => l.type === 'DELIVERY')?.city ?? '?'}`;

interface Body {
  summary: { label: string; value: number | string | null; format: Format }[];
  columns: Col[];
  rows: Row[];
  chart?: { type: 'bar' | 'line' | 'pie'; xKey: string; series: { key: string; label: string; format: Format }[]; data: Row[] } | null;
}

const countSummary = (label: string, rows: Row[]): Body['summary'] => [{ label, value: rows.length, format: 'number' }];

async function fleetRows(t: string) {
  return prisma.tanker.findMany({ where: { transporterId: t }, orderBy: { registrationNumber: 'asc' }, include: { tankerType: { select: { name: true } }, assignedDriver: { select: { user: { select: { fullName: true } } } }, availabilityBlocks: { where: { cancelledAt: null, kind: 'MAINTENANCE' }, select: { startAt: true, endAt: true } } } });
}

async function offerRows(t: string, r: ReturnType<typeof range>, status?: string[]) {
  const rows = await prisma.transporterOffer.findMany({
    where: { transporterId: t, createdAt: { gte: r.gte, lte: r.lte }, ...(status ? { status: { in: status as never[] } } : {}) },
    orderBy: { createdAt: 'desc' }, take: 5000,
    select: { status: true, initialAmount: true, currentAmount: true, round: true, createdAt: true, booking: { select: { bookingCode: true, customerOffer: true, company: { select: { name: true } }, locations: { select: { type: true, city: true } } } } },
  });
  return rows.map((o) => ({ booking: o.booking.bookingCode, company: o.booking.company.name, route: route(o.booking.locations), customerOffer: o.booking.customerOffer.toNumber(), firstOffer: o.initialAmount.toNumber(), latest: o.currentAmount.toNumber(), rounds: o.round, status: o.status, submitted: o.createdAt }));
}
const OFFER_COLS = [c('booking', 'Booking'), c('company', 'Company'), c('route', 'Route'), c('customerOffer', 'Customer offer', 'currency'), c('firstOffer', 'First offer', 'currency'), c('latest', 'Latest', 'currency'), c('rounds', 'Rounds', 'number'), c('status', 'Status'), c('submitted', 'Submitted', 'datetime')];

async function tripRows(t: string, r: ReturnType<typeof range>) {
  return prisma.trip.findMany({
    where: { transporterId: t, createdAt: { gte: r.gte, lte: r.lte } }, orderBy: { createdAt: 'desc' }, take: 5000,
    select: { tripCode: true, status: true, exception: true, createdAt: true, deliveredAt: true, completedAt: true, plannedEndAt: true, plannedDistanceKm: true, tanker: { select: { registrationNumber: true } }, driver: { select: { user: { select: { fullName: true } } } }, booking: { select: { bookingCode: true, locations: { select: { type: true, city: true } } } } },
  });
}
type TR = Awaited<ReturnType<typeof tripRows>>[number];
const shapeTrip = (x: TR) => ({ trip: x.tripCode, booking: x.booking.bookingCode, route: route(x.booking.locations), tanker: x.tanker?.registrationNumber ?? '-', driver: x.driver?.user.fullName ?? '-', status: x.status, km: x.plannedDistanceKm.toNumber(), created: x.createdAt, delivered: x.deliveredAt });
const TRIP_COLS = [c('trip', 'Trip'), c('booking', 'Booking'), c('route', 'Route'), c('tanker', 'Tanker'), c('driver', 'Driver'), c('status', 'Status'), c('km', 'Distance', 'km'), c('created', 'Created', 'datetime'), c('delivered', 'Delivered', 'datetime')];

function groupCount(rows: Row[], key: string, valueLabel = 'trips') {
  const m = new Map<string, number>();
  for (const r of rows) m.set(String(r[key]), (m.get(String(r[key])) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ [key]: k, [valueLabel]: v }));
}

async function financeRows(t: string, r: ReturnType<typeof range>) {
  const cs = await prisma.bookingCommission.findMany({ where: { transporterId: t, computedAt: { gte: r.gte, lte: r.lte } }, orderBy: { computedAt: 'desc' }, take: 5000 });
  const [bs, ss] = await Promise.all([
    prisma.booking.findMany({ where: { id: { in: cs.map((x) => x.bookingId) } }, select: { id: true, bookingCode: true, company: { select: { name: true } } } }),
    prisma.settlement.findMany({ where: { transporterId: t, allocationId: { in: cs.map((x) => x.allocationId) } } }),
  ]);
  const bm = new Map(bs.map((b) => [b.id, b]));
  const sm = new Map(ss.map((s) => [s.allocationId, s]));
  return cs.map((x) => ({ booking: bm.get(x.bookingId)?.bookingCode ?? '', company: bm.get(x.bookingId)?.company.name ?? '', freight: x.freightAmount.toNumber(), commission: x.commissionAmount.toNumber(), net: x.transporterPayable.toNumber(), settlement: sm.get(x.allocationId)?.status ?? 'PENDING', code: sm.get(x.allocationId)?.settlementCode ?? '-', settledAt: sm.get(x.allocationId)?.settledAt ?? null, computedAt: x.computedAt }));
}
const FIN_COLS = [c('booking', 'Booking'), c('company', 'Company'), c('freight', 'Freight', 'currency'), c('commission', 'Commission', 'currency'), c('net', 'Net payable', 'currency'), c('settlement', 'Settlement'), c('code', 'Reference'), c('settledAt', 'Settled', 'datetime')];
const money = (rows: { [k: string]: unknown }[], k: string) => rows.reduce((n, r) => n + Number(r[k] ?? 0), 0);

async function body(t: string, key: Key, r: ReturnType<typeof range>): Promise<Body> {
  switch (key) {
    case 'total-tankers':
    case 'available-tankers': {
      const f = (await fleetRows(t)).filter((k) => key === 'total-tankers' || k.status === 'AVAILABLE');
      const rows = f.map((k) => ({ tanker: k.registrationNumber, type: k.tankerType.name, capacity: k.capacityKl.toNumber(), status: k.status, verification: k.verificationStatus, driver: k.assignedDriver?.user.fullName ?? '-', location: k.availableLocation ?? '-' }));
      return { summary: countSummary('Tankers', rows), columns: [c('tanker', 'Tanker'), c('type', 'Type'), c('capacity', 'KL', 'number'), c('status', 'Status'), c('verification', 'Verification'), c('driver', 'Driver'), c('location', 'Available at')], rows, chart: { type: 'bar', xKey: 'status', series: [{ key: 'tankers', label: 'Tankers', format: 'number' }], data: groupCount(rows, 'status', 'tankers') } };
    }
    case 'tanker-utilization': {
      const [f, trips] = await Promise.all([fleetRows(t), tripRows(t, r)]);
      const days = Math.max(1, (r.lte.getTime() - r.gte.getTime()) / 86400_000);
      const rows = f.map((k) => {
        const mine = trips.filter((x) => x.tanker?.registrationNumber === k.registrationNumber && x.status !== 'CANCELLED');
        const busy = mine.reduce((n, x) => n + (x.deliveredAt ? Math.max(0, (x.deliveredAt.getTime() - x.createdAt.getTime()) / 86400_000) : 0), 0);
        return { tanker: k.registrationNumber, trips: mine.length, busyDays: Math.round(busy * 10) / 10, utilization: Math.min(100, pct(busy, days)) };
      });
      return { summary: [{ label: 'Average utilization', value: rows.length ? Math.round((money(rows, 'utilization') / rows.length) * 10) / 10 : 0, format: 'percent' }], columns: [c('tanker', 'Tanker'), c('trips', 'Trips', 'number'), c('busyDays', 'Busy days', 'number'), c('utilization', 'Utilization', 'percent')], rows, chart: { type: 'bar', xKey: 'tanker', series: [{ key: 'utilization', label: 'Utilization', format: 'percent' }], data: rows.slice(0, 15) } };
    }
    case 'tanker-trip-history': {
      const rows = (await tripRows(t, r)).filter((x) => x.tanker).map(shapeTrip);
      return { summary: countSummary('Trips', rows), columns: TRIP_COLS, rows, chart: { type: 'bar', xKey: 'tanker', series: [{ key: 'trips', label: 'Trips', format: 'number' }], data: groupCount(rows, 'tanker').slice(0, 15) } };
    }
    case 'maintenance-status': {
      const f = await fleetRows(t);
      const rows = f.filter((k) => k.status === 'MAINTENANCE' || k.availabilityBlocks.some((b) => b.endAt >= new Date())).map((k) => { const b = k.availabilityBlocks.find((x) => x.endAt >= new Date()); return { tanker: k.registrationNumber, status: k.status, from: b?.startAt ?? null, to: b?.endAt ?? null }; });
      return { summary: countSummary('Under or scheduled for maintenance', rows), columns: [c('tanker', 'Tanker'), c('status', 'Status'), c('from', 'From', 'datetime'), c('to', 'To', 'datetime')], rows };
    }
    case 'document-expiry': {
      const f = await fleetRows(t);
      const rows = f.flatMap((k) => ([['Insurance', k.insuranceExpiry], ['Fitness', k.fitnessExpiry], ['Permit', k.permitExpiry], ['PUC', k.pucExpiry], ['PESO', k.pesoExpiry]] as const).filter(([, d]) => d).map(([doc, d]) => ({ tanker: k.registrationNumber, document: doc, expiry: d, daysLeft: Math.ceil((d!.getTime() - Date.now()) / 86400_000) }))).sort((a, b) => a.daysLeft - b.daysLeft);
      return { summary: [{ label: 'Expired', value: rows.filter((x) => x.daysLeft < 0).length, format: 'number' }, { label: 'Expiring in 30 days', value: rows.filter((x) => x.daysLeft >= 0 && x.daysLeft <= 30).length, format: 'number' }], columns: [c('tanker', 'Tanker'), c('document', 'Document'), c('expiry', 'Expiry', 'date'), c('daysLeft', 'Days left', 'number')], rows };
    }
    case 'booking-requests':
    case 'offers-submitted': {
      const rows = await offerRows(t, r);
      return { summary: countSummary(key === 'booking-requests' ? 'Requests responded to' : 'Offers submitted', rows), columns: OFFER_COLS, rows, chart: { type: 'pie', xKey: 'status', series: [{ key: 'offers', label: 'Offers', format: 'number' }], data: groupCount(rows, 'status', 'offers') } };
    }
    case 'offers-accepted': { const rows = await offerRows(t, r, ['ACCEPTED']); return { summary: [...countSummary('Accepted', rows), { label: 'Value', value: money(rows, 'latest'), format: 'currency' }], columns: OFFER_COLS, rows }; }
    case 'offers-rejected': { const rows = await offerRows(t, r, ['REJECTED', 'UNSUCCESSFUL']); return { summary: countSummary('Rejected or unsuccessful', rows), columns: OFFER_COLS, rows }; }
    case 'offer-conversion':
    case 'acceptance-rate': {
      const rows = await offerRows(t, r);
      const by = groupCount(rows, 'status', 'offers') as { status: string; offers: number }[];
      const won = rows.filter((x) => x.status === 'ACCEPTED').length;
      const closed = rows.filter((x) => !['PENDING', 'COUNTERED'].includes(x.status)).length;
      return { summary: [{ label: key === 'offer-conversion' ? 'Conversion rate' : 'Acceptance rate', value: pct(won, closed), format: 'percent' }, { label: 'Accepted', value: won, format: 'number' }, { label: 'Closed offers', value: closed, format: 'number' }], columns: [c('status', 'Status'), c('offers', 'Offers', 'number')], rows: by, chart: { type: 'pie', xKey: 'status', series: [{ key: 'offers', label: 'Offers', format: 'number' }], data: by } };
    }
    case 'confirmed-bookings':
    case 'cancelled-bookings': {
      const cancelled = key === 'cancelled-bookings';
      const list = await prisma.bookingAllocation.findMany({ where: { transporterId: t, createdAt: { gte: r.gte, lte: r.lte }, ...(cancelled ? { status: 'CANCELLED' as const } : { status: { not: 'CANCELLED' as const } }) }, orderBy: { createdAt: 'desc' }, take: 5000, select: { status: true, tankersAllocated: true, agreedFreight: true, createdAt: true, booking: { select: { bookingCode: true, company: { select: { name: true } }, locations: { select: { type: true, city: true } } } } } });
      const rows = list.map((a) => ({ booking: a.booking.bookingCode, company: a.booking.company.name, route: route(a.booking.locations), tankers: a.tankersAllocated, freight: a.agreedFreight.toNumber(), status: a.status, confirmed: a.createdAt }));
      return { summary: [...countSummary('Bookings', rows), { label: 'Freight', value: money(rows, 'freight'), format: 'currency' }], columns: [c('booking', 'Booking'), c('company', 'Company'), c('route', 'Route'), c('tankers', 'Tankers', 'number'), c('freight', 'Agreed freight', 'currency'), c('status', 'Status'), c('confirmed', 'Confirmed', 'datetime')], rows };
    }
    case 'active-trips':
    case 'completed-trips':
    case 'delayed-trips': {
      const all = await tripRows(t, r);
      const pick = key === 'active-trips' ? all.filter((x) => ACTIVE_TRIP.includes(x.status)) : key === 'completed-trips' ? all.filter((x) => x.status === 'COMPLETED' || x.status === 'DELIVERED') : all.filter((x) => x.exception === 'DELAYED' || (x.plannedEndAt && (x.deliveredAt ?? new Date()) > x.plannedEndAt && x.status !== 'CANCELLED'));
      const rows = pick.map(shapeTrip);
      return { summary: countSummary('Trips', rows), columns: TRIP_COLS, rows };
    }
    case 'route-trips':
    case 'driver-trips': {
      const k = key === 'route-trips' ? 'route' : 'driver';
      const rows = (await tripRows(t, r)).map(shapeTrip);
      const grouped = groupCount(rows, k);
      return { summary: [{ label: key === 'route-trips' ? 'Routes' : 'Drivers', value: grouped.length, format: 'number' }, { label: 'Trips', value: rows.length, format: 'number' }], columns: [c(k, key === 'route-trips' ? 'Route' : 'Driver'), c('trips', 'Trips', 'number')], rows: grouped, chart: { type: 'bar', xKey: k, series: [{ key: 'trips', label: 'Trips', format: 'number' }], data: grouped.slice(0, 15) } };
    }
    case 'monthly-earnings': {
      const rows = await financeRows(t, r);
      const m = new Map<string, { month: string; freight: number; commission: number; net: number }>();
      for (const x of rows) { const k = x.computedAt.toISOString().slice(0, 7); const v = m.get(k) ?? { month: k, freight: 0, commission: 0, net: 0 }; v.freight += x.freight; v.commission += x.commission; v.net += x.net; m.set(k, v); }
      const data = [...m.values()].sort((a, b) => a.month.localeCompare(b.month));
      return { summary: [{ label: 'Freight', value: money(rows, 'freight'), format: 'currency' }, { label: 'Net', value: money(rows, 'net'), format: 'currency' }], columns: [c('month', 'Month'), c('freight', 'Freight', 'currency'), c('commission', 'Commission', 'currency'), c('net', 'Net', 'currency')], rows: data, chart: { type: 'bar', xKey: 'month', series: [{ key: 'freight', label: 'Freight', format: 'currency' }], data } };
    }
    case 'booking-earnings':
    case 'commission-deductions': {
      const rows = await financeRows(t, r);
      return { summary: [{ label: 'Freight', value: money(rows, 'freight'), format: 'currency' }, { label: 'Commission', value: money(rows, 'commission'), format: 'currency' }, { label: 'Net', value: money(rows, 'net'), format: 'currency' }], columns: FIN_COLS, rows };
    }
    case 'pending-settlements':
    case 'completed-settlements': {
      const rows = (await financeRows(t, r)).filter((x) => (key === 'completed-settlements' ? x.settlement === 'SETTLED' : x.settlement !== 'SETTLED'));
      return { summary: [...countSummary('Settlements', rows), { label: 'Amount', value: money(rows, 'net'), format: 'currency' }], columns: FIN_COLS, rows };
    }
    case 'trip-completion-rate':
    case 'cancellation-rate': {
      const rows = (await tripRows(t, r)).map(shapeTrip);
      const done = rows.filter((x) => x.status === 'COMPLETED' || x.status === 'DELIVERED').length;
      const cancelled = rows.filter((x) => x.status === 'CANCELLED').length;
      const by = groupCount(rows, 'status');
      return { summary: [{ label: key === 'trip-completion-rate' ? 'Completion rate' : 'Cancellation rate', value: pct(key === 'trip-completion-rate' ? done : cancelled, rows.length), format: 'percent' }, { label: 'Trips', value: rows.length, format: 'number' }], columns: [c('status', 'Status'), c('trips', 'Trips', 'number')], rows: by, chart: { type: 'pie', xKey: 'status', series: [{ key: 'trips', label: 'Trips', format: 'number' }], data: by } };
    }
    case 'customer-rating': {
      const a = await prisma.agency.findUniqueOrThrow({ where: { id: t }, select: { rating: true, completedTrips: true } });
      const rows = [{ metric: 'Average customer rating (out of 5)', value: a.rating.toNumber() }, { metric: 'Completed trips', value: a.completedTrips }];
      return { summary: [{ label: 'Average rating', value: a.rating.toNumber(), format: 'number' }], columns: [c('metric', 'Metric'), c('value', 'Value', 'number')], rows };
    }
  }
}

export async function runTransporterReport(transporterId: string, key: string, params: { from?: string; to?: string }) {
  if (!(key in REPORTS)) throw AppError.notFound('Unknown report');
  const r = range(params);
  const [title, group] = REPORTS[key as Key];
  return { key, title, description: `${group} report`, range: { from: r.from, to: r.to }, chart: null, ...(await body(transporterId, key as Key, r)) };
}
