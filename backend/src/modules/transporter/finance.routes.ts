import { Prisma } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { round2 } from '../../lib/money';
import { prisma } from '../../lib/prisma';
import { authenticateUser } from '../../middleware/auth';
import { requireTransporter } from '../../middleware/transporter';
import { validateRequest } from '../../middleware/validate';
import { AppError } from '../../utils/errors';
import { ok } from '../../utils/response';
import { audit } from '../audit/audit';
import { ist, istDate, money, renderPdf } from '../documents/pdf.service';
import { reportToPdf, reportToXlsx } from '../reports/report.export';
import type { ReportResult } from '../reports/report.service';
import { idParam, tid } from './common';
import { REPORT_LIST, runTransporterReport } from './reports.service';

/**
 * Read-only views over the trusted financial records written by the commission engine and the Admin
 * Portal. There is deliberately no route here that writes commission, settlement or payment state.
 */
export const transporterFinanceRouter = Router();
const finance = [authenticateUser, requireTransporter({ permission: 'agency:finance:access' })];
const read = [authenticateUser, requireTransporter({ permission: 'agency:read' })];

async function ledger(transporterId: string) {
  const commissions = await prisma.bookingCommission.findMany({ where: { transporterId }, orderBy: { computedAt: 'desc' }, take: 2000, include: { rule: { select: { name: true, calcType: true, value: true } } } });
  const [settlements, allocations] = await Promise.all([
    prisma.settlement.findMany({ where: { transporterId, allocationId: { in: commissions.map((c) => c.allocationId) } } }),
    prisma.bookingAllocation.findMany({ where: { transporterId, id: { in: commissions.map((c) => c.allocationId) } }, select: { id: true, status: true, booking: { select: { id: true, bookingCode: true, paymentStatus: true, isDemo: true, company: { select: { name: true } } } } } }),
  ]);
  const sm = new Map(settlements.map((s) => [s.allocationId, s]));
  const am = new Map(allocations.map((a) => [a.id, a]));
  return commissions.map((c) => {
    const s = sm.get(c.allocationId);
    const a = am.get(c.allocationId);
    const paid = s?.status === 'SETTLED' ? s.amount.toNumber() : 0;
    const net = c.transporterPayable.toNumber();
    return {
      allocationId: c.allocationId, bookingId: c.bookingId, bookingCode: a?.booking.bookingCode ?? '', company: a?.booking.company.name ?? '', isDemo: a?.booking.isDemo ?? false, allocationStatus: a?.status ?? null, companyPaymentStatus: a?.booking.paymentStatus ?? null,
      agreedFreight: c.freightAmount.toNumber(), commission: c.commissionAmount.toNumber(), commissionRule: c.rule ? `${c.rule.name}` : 'No rule (0%)',
      commissionPercent: c.rule?.calcType === 'PERCENT' ? c.rule.value.toNumber() : null, otherCharges: 0, taxes: 0, netPayable: net, paidAmount: paid, balance: round2(net - paid).toNumber(),
      settlementId: s?.id ?? null, settlementCode: s?.settlementCode ?? null, settlementStatus: s?.status ?? 'PENDING', settlementDate: s?.settledAt ?? null, reference: s?.reference ?? null, computedAt: c.computedAt,
    };
  });
}

const sum = <T,>(rows: T[], f: (r: T) => number) => round2(rows.reduce((n, r) => n + f(r), 0)).toNumber();

transporterFinanceRouter.get('/me/earnings', ...finance, async (req, res) => {
  const rows = await ledger(tid(req));
  const month = new Date().toISOString().slice(0, 7);
  const done = rows.filter((r) => r.allocationStatus === 'COMPLETED');
  ok(res, 'Earnings', {
    summary: {
      totalFreight: sum(rows, (r) => r.agreedFreight),
      monthlyFreight: sum(rows.filter((r) => r.computedAt.toISOString().startsWith(month)), (r) => r.agreedFreight),
      completedTripEarnings: sum(done, (r) => r.netPayable),
      pendingPayments: sum(rows, (r) => r.balance),
      settledAmount: sum(rows, (r) => r.paidAmount),
      platformCommission: sum(rows, (r) => r.commission),
      outstandingSettlements: sum(rows.filter((r) => r.settlementStatus !== 'SETTLED'), (r) => r.netPayable),
    },
    items: rows,
  });
});

transporterFinanceRouter.get('/me/payments', ...finance, async (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const rows = await ledger(tid(req));
  ok(res, 'Payments', { items: status ? rows.filter((r) => r.settlementStatus === status) : rows });
});

transporterFinanceRouter.get('/me/commissions', ...finance, async (req, res) => {
  const rows = await ledger(tid(req));
  ok(res, 'Commissions', { totalFreight: sum(rows, (r) => r.agreedFreight), totalCommission: sum(rows, (r) => r.commission), items: rows });
});

transporterFinanceRouter.get('/me/settlements', ...finance, async (req, res) => {
  const rows = await ledger(tid(req));
  ok(res, 'Settlements', { items: rows.filter((r) => r.settlementId) });
});

const statementSpec = (title: string, ref: string, who: { companyName: string; transporterCode: string; isDemo: boolean }, rows: Awaited<ReturnType<typeof ledger>>) => ({
  title,
  reference: ref,
  subtitle: `${who.companyName} (${who.transporterCode})`,
  demo: who.isDemo,
  sections: [],
  table: {
    title: 'Booking-wise settlement',
    head: ['Booking', 'Freight', 'Commission', 'Net', 'Paid', 'Status'],
    rows: rows.map((r) => [r.bookingCode, money(r.agreedFreight), money(r.commission), money(r.netPayable), money(r.paidAmount), r.settlementStatus]),
    widths: [90, 90, 85, 90, 85, 55],
    totals: [['Total net payable', money(sum(rows, (r) => r.netPayable))], ['Total paid', money(sum(rows, (r) => r.paidAmount))]] as [string, string][],
  },
  footer: 'Generated from TankerLink settlement records. Times are India Standard Time.',
});

const pdfResponse = (res: Response, name: string, buf: Buffer, inline: boolean) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buf);
};

const whoIs = (id: string) => prisma.agency.findUniqueOrThrow({ where: { id }, select: { companyName: true, transporterCode: true, isDemo: true, gstNumber: true, address: true, city: true, state: true } });

transporterFinanceRouter.get('/me/statement.pdf', ...finance, async (req: Request, res: Response) => {
  const who = await whoIs(tid(req));
  const buf = await renderPdf(statementSpec('Earnings Statement', `As of ${ist(new Date(), false)}`, who, await ledger(tid(req))));
  await audit({ action: 'transporter.statement_downloaded', entityType: 'transporter', entityId: tid(req), actorType: 'TRANSPORTER', actorUserId: req.auth!.principal.userId, req });
  pdfResponse(res, `statement-${who.transporterCode}.pdf`, buf, req.query.inline === '1');
});

transporterFinanceRouter.get('/me/settlements/:id/statement.pdf', ...finance, idParam, async (req: Request, res: Response) => {
  const rows = (await ledger(tid(req))).filter((r) => r.settlementId === String(req.params.id));
  if (!rows.length) throw AppError.notFound('Settlement not found');
  const who = await whoIs(tid(req));
  const r = rows[0];
  const buf = await renderPdf({
    title: 'Settlement Statement', reference: r.settlementCode ?? '', subtitle: `${who.companyName} (${who.transporterCode})`, demo: r.isDemo,
    sections: [
      { title: 'Booking', rows: [['Booking', r.bookingCode], ['Company', r.company], ['Status', r.settlementStatus], ['Settled on', ist(r.settlementDate)], ['Bank reference', r.reference ?? '-']] },
      { title: 'Amounts', rows: [['Total booking freight', money(r.agreedFreight)], ['Commission rule', r.commissionRule], ['Commission', money(r.commission)], ['Applicable taxes', money(r.taxes)], ['Net settlement', money(r.netPayable)]] },
    ],
    footer: 'Commission follows platform rules at the time of confirmation.',
  });
  pdfResponse(res, `${r.settlementCode}.pdf`, buf, req.query.inline === '1');
});

// ---- Document centre -------------------------------------------------------------------------

const DOC_LABEL: Record<string, string> = { BOOKING_CONFIRMATION: 'Booking confirmation', FREIGHT_INVOICE: 'Freight invoice', SETTLEMENT_STATEMENT: 'Settlement statement', PAYMENT_RECEIPT: 'Payment receipt' };

transporterFinanceRouter.get('/me/documents-centre', ...read, async (req: Request, res: Response) => {
  const q = z.object({ type: z.string().optional(), bookingCode: z.string().trim().optional(), from: z.string().optional(), to: z.string().optional() }).catch({}).parse(req.query);
  const t = tid(req);
  const [allocations, tripDocs, settlements] = await Promise.all([
    prisma.bookingAllocation.findMany({ where: { transporterId: t, status: { not: 'CANCELLED' } }, select: { id: true, createdAt: true, booking: { select: { id: true, bookingCode: true, isDemo: true } } }, orderBy: { createdAt: 'desc' }, take: 500 }),
    prisma.tripDocument.findMany({ where: { trip: { transporterId: t } }, orderBy: { createdAt: 'desc' }, take: 500, select: { id: true, tripId: true, type: true, title: true, fileName: true, createdAt: true, isDemo: true, booking: { select: { id: true, bookingCode: true } } } }),
    prisma.settlement.findMany({ where: { transporterId: t }, select: { id: true, settlementCode: true, allocationId: true, status: true, settledAt: true, createdAt: true } }),
  ]);
  const allocs = new Map(allocations.map((a) => [a.id, a]));
  const docs = [
    ...allocations.flatMap((a) => [
      { key: `conf-${a.id}`, type: 'BOOKING_CONFIRMATION', title: `Booking confirmation ${a.booking.bookingCode}`, bookingCode: a.booking.bookingCode, bookingId: a.booking.id, date: a.createdAt, isDemo: a.booking.isDemo, href: `/transporters/me/allocations/${a.id}/confirmation.pdf` },
      { key: `inv-${a.id}`, type: 'FREIGHT_INVOICE', title: `Freight invoice ${a.booking.bookingCode}`, bookingCode: a.booking.bookingCode, bookingId: a.booking.id, date: a.createdAt, isDemo: a.booking.isDemo, href: `/transporters/me/allocations/${a.id}/freight-invoice.pdf` },
    ]),
    ...settlements.flatMap((s) => {
      const a = allocs.get(s.allocationId);
      if (!a) return [];
      const rows = [{ key: `stl-${s.id}`, type: 'SETTLEMENT_STATEMENT', title: `Settlement ${s.settlementCode}`, bookingCode: a.booking.bookingCode, bookingId: a.booking.id, date: s.settledAt ?? s.createdAt, isDemo: a.booking.isDemo, href: `/transporters/me/settlements/${s.id}/statement.pdf` }];
      if (s.status === 'SETTLED') rows.push({ ...rows[0], key: `rcp-${s.id}`, type: 'PAYMENT_RECEIPT', title: `Payout advice ${s.settlementCode}` });
      return rows;
    }),
    ...tripDocs.map((d) => ({ key: `trip-${d.id}`, type: d.type, title: d.title, bookingCode: d.booking.bookingCode, bookingId: d.booking.id, date: d.createdAt, isDemo: d.isDemo, href: `/trips/${d.tripId}/documents/${d.id}/download` })),
  ]
    .filter((d) => !q.type || d.type === q.type)
    .filter((d) => !q.bookingCode || d.bookingCode.toLowerCase().includes(q.bookingCode.toLowerCase()))
    .filter((d) => !q.from || d.date.toISOString().slice(0, 10) >= q.from)
    .filter((d) => !q.to || d.date.toISOString().slice(0, 10) <= q.to)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  ok(res, 'Documents', { items: docs.map((d) => ({ ...d, typeLabel: DOC_LABEL[d.type] ?? d.type.replace(/_/g, ' ').toLowerCase() })) });
});

async function ownAllocation(req: Request) {
  const a = await prisma.bookingAllocation.findFirst({
    where: { id: String(req.params.id), transporterId: tid(req) },
    include: { booking: { include: { company: { select: { name: true, gstNumber: true } }, product: { select: { name: true } }, requirement: true, locations: true } } },
  });
  if (!a) throw AppError.notFound('Booking not found');
  return a;
}

transporterFinanceRouter.get('/me/allocations/:id/confirmation.pdf', ...read, idParam, async (req: Request, res: Response) => {
  const a = await ownAllocation(req);
  const who = await whoIs(tid(req));
  const p = a.booking.locations.find((l) => l.type === 'PICKUP');
  const d = a.booking.locations.find((l) => l.type === 'DELIVERY');
  const buf = await renderPdf({
    title: 'Booking Confirmation', reference: a.booking.bookingCode, subtitle: `${who.companyName} (${who.transporterCode})`, demo: a.booking.isDemo,
    sections: [
      { title: 'Company', rows: [['Company', a.booking.company.name], ['Loading contact', `${a.booking.loadingContactName}, ${a.booking.loadingContactPhone}`], ['Delivery contact', `${a.booking.deliveryContactName}, ${a.booking.deliveryContactPhone}`]] },
      { title: 'Route', rows: [['Pickup', p?.address ?? '-'], ['Delivery', d?.address ?? '-'], ['Road distance', `${a.booking.distanceKm.toNumber()} km`]] },
      { title: 'Load', rows: [['Product', a.booking.product.name], ['Tanker capacity', `${a.booking.requirement?.tankerCapacityKl.toNumber()} KL`], ['Tankers allocated', String(a.tankersAllocated)], ['Loading', `${istDate(a.booking.loadingDate)} ${a.booking.loadingTime}`], ['Expected delivery', istDate(a.booking.expectedDeliveryDate)], ['Agreed freight', money(a.agreedFreight)]] },
    ],
  });
  pdfResponse(res, `${a.booking.bookingCode}-confirmation.pdf`, buf, req.query.inline === '1');
});

transporterFinanceRouter.get('/me/allocations/:id/freight-invoice.pdf', ...read, idParam, async (req: Request, res: Response) => {
  const a = await ownAllocation(req);
  const who = await whoIs(tid(req));
  const c = await prisma.bookingCommission.findUnique({ where: { allocationId: a.id } });
  const buf = await renderPdf({
    title: 'Freight Summary', reference: a.booking.bookingCode, subtitle: `Issued by ${who.companyName}${who.gstNumber ? ` (GSTIN ${who.gstNumber})` : ''}`, demo: a.booking.isDemo,
    sections: [
      { title: 'Billed to', rows: [['Company', a.booking.company.name], ['GSTIN', a.booking.company.gstNumber]] },
      { title: 'Freight', rows: [['Agreed freight', money(a.agreedFreight)], ['Platform commission', money(c?.commissionAmount ?? new Prisma.Decimal(0))], ['Net payable to transporter', money(c?.transporterPayable ?? a.agreedFreight)]] },
    ],
    footer: 'Freight summary for the transporter’s records. Confirm the applicable GST treatment with your tax advisor.',
  });
  pdfResponse(res, `${a.booking.bookingCode}-freight.pdf`, buf, req.query.inline === '1');
});

// ---- Reports ---------------------------------------------------------------------------------

const rangeQuery = validateRequest({ query: z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), format: z.enum(['xlsx', 'pdf']).optional() }) });

transporterFinanceRouter.get('/me/reports', ...read, (_req, res) => ok(res, 'Reports', { reports: REPORT_LIST }));

transporterFinanceRouter.get('/me/reports/:key', ...read, rangeQuery, async (req: Request, res: Response) => {
  ok(res, 'Report', { report: await runTransporterReport(tid(req), String(req.params.key), res.locals.query) });
});

transporterFinanceRouter.get('/me/reports/:key/export', ...read, rangeQuery, async (req: Request, res: Response) => {
  const report = (await runTransporterReport(tid(req), String(req.params.key), res.locals.query)) as unknown as ReportResult;
  const who = await whoIs(tid(req));
  const format = res.locals.query.format ?? 'xlsx';
  const buf = format === 'pdf' ? await reportToPdf(report, who.companyName) : await reportToXlsx(report, who.companyName);
  await audit({ action: 'report.exported', entityType: 'report', actorType: 'TRANSPORTER', actorUserId: req.auth!.principal.userId, metadata: { key: report.key, format }, req });
  res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${report.key}.${format}"`);
  res.send(buf);
});

