import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/errors';
import { CONFIRMED_OR_LATER } from '../bookings/booking.common';
import { ist, istDate, money, renderPdf, type PdfSection } from './pdf.service';

/**
 * Company document centre. Documents are always resolved through the caller's company, so another
 * company's documents can never be listed or downloaded.
 *
 * Document ids are "<TYPE>:<uuid>":
 *   BOOKING_CONFIRMATION:<bookingId>  generated PDF (confirmed bookings)
 *   BOOKING_SUMMARY:<bookingId>       generated PDF (any booking)
 *   FREIGHT_INVOICE:<invoiceId>       generated PDF
 *   PAYMENT_RECEIPT:<paymentId>       generated PDF (paid payments)
 *   TRIP_DOCUMENT:<tripDocumentId>    stored file shared by the transporter (delivery proof, LR, e-way bill)
 */
export const DOCUMENT_TYPES = ['BOOKING_CONFIRMATION', 'BOOKING_SUMMARY', 'FREIGHT_INVOICE', 'PAYMENT_RECEIPT', 'TRIP_DOCUMENT'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface DocumentItem {
  id: string;
  type: DocumentType;
  subType?: string;
  title: string;
  reference: string;
  bookingId: string;
  bookingCode: string;
  date: Date;
  isDemo: boolean;
  mimeType: string;
}

const company = (companyId: string) =>
  prisma.company.findUniqueOrThrow({ where: { id: companyId }, include: { addresses: true } });

function companySection(c: Awaited<ReturnType<typeof company>>, title = 'Bill to'): PdfSection {
  const billing = (c.billingSameAsRegistered ? null : c.addresses.find((a) => a.type === 'BILLING')) ?? c.addresses.find((a) => a.type === 'REGISTERED');
  return {
    title,
    rows: [
      ['Company', `${c.name} (${c.companyCode})`],
      ['GSTIN', c.gstNumber],
      ['Address', billing ? `${billing.address}, ${billing.city}, ${billing.state} - ${billing.pincode}` : '-'],
      ['Contact', `${c.contactPersonName}, ${c.contactPhone}, ${c.contactEmail}`],
    ],
  };
}

const bookingForDocs = {
  product: true,
  locations: true,
  requirement: { include: { tankerType: true } },
  allocations: { include: { transporter: { select: { companyName: true, gstNumber: true, city: true, state: true, isDemo: true } } } },
  trips: { select: { tripCode: true, allocationId: true, tanker: { select: { registrationNumber: true } }, driver: { select: { user: { select: { fullName: true } } } } } },
} satisfies Prisma.BookingInclude;

async function ownedBooking(companyId: string, bookingId: string) {
  const b = await prisma.booking.findFirst({ where: { id: bookingId, companyId }, include: bookingForDocs });
  if (!b) throw AppError.notFound('Document not found');
  return b;
}

function routeSections(b: Awaited<ReturnType<typeof ownedBooking>>): PdfSection[] {
  const p = b.locations.find((l) => l.type === 'PICKUP');
  const d = b.locations.find((l) => l.type === 'DELIVERY');
  return [
    {
      title: 'Route',
      rows: [
        ['Pickup', p?.address ?? '-'],
        ['Delivery', d?.address ?? '-'],
        ['Road distance', `${b.distanceKm.toNumber()} km (${b.routeProvider})`],
        ['Estimated journey', `${Math.floor(b.durationMinutes / 60)} h ${b.durationMinutes % 60} min`],
      ],
    },
    {
      title: 'Load & tanker',
      rows: [
        ['Product', b.product.name],
        ['Tanker capacity', `${b.requirement?.tankerCapacityKl.toNumber()} KL x ${b.requirement?.numberOfTankers}`],
        ['Quantity', `${b.requirement?.quantityKl.toNumber()} KL`],
        ['Tanker type', b.requirement?.tankerType?.name ?? 'Any'],
        ['Compartments', b.requirement?.compartmentRequirement ?? 'Any'],
        ['Special requirements', b.requirement?.specialRequirements ?? '-'],
      ],
    },
    {
      title: 'Schedule & contacts',
      rows: [
        ['Loading', `${istDate(b.loadingDate)} at ${b.loadingTime} IST`],
        ['Loading contact', `${b.loadingContactName}, ${b.loadingContactPhone}`],
        ['Loading instructions', b.loadingInstructions ?? '-'],
        ['Expected delivery', istDate(b.expectedDeliveryDate)],
        ['Delivery contact', `${b.deliveryContactName}, ${b.deliveryContactPhone}`],
        ['Delivery instructions', b.deliveryInstructions ?? '-'],
      ],
    },
  ];
}

export async function bookingSummaryPdf(companyId: string, bookingId: string) {
  const b = await ownedBooking(companyId, bookingId);
  const c = await company(companyId);
  const buffer = await renderPdf({
    title: 'Booking Summary',
    reference: b.bookingCode,
    subtitle: `Created ${ist(b.createdAt)} · Status: ${b.status.replace(/_/g, ' ')}`,
    demo: b.isDemo,
    sections: [
      companySection(c, 'Company'),
      ...routeSections(b),
      {
        title: 'Commercials',
        rows: [
          ['Suggested freight (estimate)', money(b.suggestedFreight)],
          ['Your offer', money(b.customerOffer)],
          ['Agreed freight', b.acceptedFreight ? money(b.acceptedFreight) : 'Not yet agreed'],
        ],
      },
    ],
  });
  return { buffer, fileName: `${b.bookingCode}-summary.pdf` };
}

export async function bookingConfirmationPdf(companyId: string, bookingId: string) {
  const b = await ownedBooking(companyId, bookingId);
  if (!CONFIRMED_OR_LATER.includes(b.status) || !b.acceptedFreight) throw AppError.notFound('Booking confirmation is available after a transporter is confirmed');
  const c = await company(companyId);
  const allocs = b.allocations.filter((a) => a.status !== 'CANCELLED');
  const buffer = await renderPdf({
    title: 'Booking Confirmation',
    reference: b.bookingCode,
    subtitle: `Confirmed ${ist(b.confirmedAt)}`,
    demo: b.isDemo || allocs.some((a) => a.transporter.isDemo),
    sections: [
      companySection(c, 'Company'),
      ...allocs.map((alloc, i) => ({
        title: allocs.length > 1 ? `Transporter ${i + 1} of ${allocs.length}` : 'Transporter',
        rows: [
          ['Transporter', alloc.transporter.companyName],
          ['Location', `${alloc.transporter.city}, ${alloc.transporter.state}`],
          ['GSTIN', alloc.transporter.gstNumber ?? '-'],
          ['Tankers allocated', String(alloc.tankersAllocated)],
          ['Agreed freight', money(alloc.agreedFreight)],
          ...b.trips
            .filter((t) => t.allocationId === alloc.id)
            .map((t): [string, string] => [`Trip ${t.tripCode}`, `Vehicle ${t.tanker?.registrationNumber ?? 'to be assigned'} · Driver ${t.driver?.user.fullName ?? 'to be assigned'}`]),
        ] as [string, string][],
      })),
      ...routeSections(b),
      { title: 'Agreed freight', rows: [['Agreed freight (excl. fees & GST)', money(b.acceptedFreight)]] },
    ],
    footer: 'Freight is locked at the agreed amount above. Platform fee and GST, where applicable, are shown on the freight invoice.',
  });
  return { buffer, fileName: `${b.bookingCode}-confirmation.pdf` };
}

export async function invoicePdf(companyId: string, invoiceId: string) {
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId } });
  if (!inv) throw AppError.notFound('Document not found');
  const b = await ownedBooking(companyId, inv.bookingId);
  const c = await company(companyId);
  // One invoice is issued per allocation; match it to its allocation by freight amount.
  const alloc = b.allocations.find((a) => a.agreedFreight.equals(inv.freightAmount)) ?? b.allocations[0];
  const p = b.locations.find((l) => l.type === 'PICKUP');
  const d = b.locations.find((l) => l.type === 'DELIVERY');
  const buffer = await renderPdf({
    title: 'Freight Invoice',
    reference: inv.invoiceNumber,
    subtitle: `Issued ${ist(inv.issuedAt)} · Booking ${b.bookingCode} · Status: ${inv.status.replace(/_/g, ' ')}`,
    demo: b.isDemo || Boolean(alloc?.transporter.isDemo),
    sections: [companySection(c), { title: 'Service', rows: [['Transporter', alloc?.transporter.companyName ?? '-'], ['Route', `${p?.city ?? p?.address} → ${d?.city ?? d?.address}`], ['Product', b.product.name]] }],
    table: {
      title: 'Charges',
      head: ['Description', 'Basis', 'Amount'],
      widths: [240, 140, 115],
      rows: [
        ['Freight charges', `${b.distanceKm.toNumber()} km, ${alloc?.tankersAllocated ?? b.requirement?.numberOfTankers} tanker(s)`, money(inv.freightAmount)],
        ['Platform fee', 'On freight', money(inv.platformFee)],
        [`GST @ ${inv.gstPercent.toNumber()}%`, 'On freight + platform fee', money(inv.gstAmount)],
      ],
      totals: [['Total payable', money(inv.totalAmount)]],
    },
    footer: 'GST is applied at the configured rate where applicable. Please contact support for tax-related queries.',
  });
  return { buffer, fileName: `${inv.invoiceNumber}.pdf` };
}

export async function receiptPdf(companyId: string, paymentId: string) {
  const pay = await prisma.payment.findFirst({ where: { id: paymentId, companyId } });
  if (!pay || !pay.receiptNumber || !['PAID', 'REFUND_PENDING', 'REFUNDED'].includes(pay.status)) throw AppError.notFound('Receipt is available for completed payments only');
  const b = await ownedBooking(companyId, pay.bookingId);
  const c = await company(companyId);
  const buffer = await renderPdf({
    title: 'Payment Receipt',
    reference: pay.receiptNumber,
    subtitle: `Paid ${ist(pay.paidAt)} · Booking ${b.bookingCode}`,
    demo: b.isDemo || pay.provider === 'MOCK',
    sections: [
      companySection(c, 'Received from'),
      {
        title: 'Payment',
        rows: [
          ['Amount', money(pay.amount)],
          ['Purpose', pay.purpose.toLowerCase()],
          ['Method', pay.method ?? '-'],
          ['Gateway', pay.provider === 'MOCK' ? 'Development payment simulator (not a real payment)' : 'Razorpay'],
          ['Order ID', pay.providerOrderId],
          ['Payment ID', pay.providerPaymentId ?? '-'],
          ['Status', pay.status.replace(/_/g, ' ')],
        ],
      },
    ],
  });
  return { buffer, fileName: `${pay.receiptNumber}.pdf` };
}

/** Simulated delivery proof generated by the demo trip simulator. */
export async function demoDeliveryProofPdf(bookingId: string) {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: bookingForDocs });
  const trip = b.trips[0];
  return renderPdf({
    title: 'Proof of Delivery',
    reference: trip?.tripCode ?? b.bookingCode,
    subtitle: `Booking ${b.bookingCode} · Delivered ${ist(new Date())}`,
    demo: true,
    sections: [
      ...routeSections(b).slice(0, 2),
      {
        title: 'Delivery',
        rows: [
          ['Vehicle', trip?.tanker?.registrationNumber ?? '-'],
          ['Driver', trip?.driver?.user.fullName ?? '-'],
          ['Received by', b.deliveryContactName],
          ['Quantity delivered', `${b.requirement?.quantityKl.toNumber()} KL`],
          ['Remarks', 'Seal intact. Received in good condition. (simulated)'],
        ],
      },
    ],
    footer: 'Simulated document generated by the TankerLink demo environment.',
  });
}

export async function listDocuments(companyId: string, filter: { type?: DocumentType; bookingId?: string; from?: string; to?: string }) {
  const range =
    filter.from || filter.to
      ? { ...(filter.from ? { gte: new Date(`${filter.from}T00:00:00+05:30`) } : {}), ...(filter.to ? { lte: new Date(`${filter.to}T23:59:59.999+05:30`) } : {}) }
      : undefined;
  const bookingWhere = { companyId, ...(filter.bookingId ? { id: filter.bookingId } : {}) };
  const want = (t: DocumentType) => !filter.type || filter.type === t;
  const items: DocumentItem[] = [];

  if (want('BOOKING_CONFIRMATION')) {
    const rows = await prisma.booking.findMany({
      where: { ...bookingWhere, status: { in: CONFIRMED_OR_LATER }, acceptedFreight: { not: null }, ...(range ? { confirmedAt: range } : {}) },
      select: { id: true, bookingCode: true, confirmedAt: true, isDemo: true },
    });
    rows.forEach((b) =>
      items.push({ id: `BOOKING_CONFIRMATION:${b.id}`, type: 'BOOKING_CONFIRMATION', title: 'Booking confirmation', reference: b.bookingCode, bookingId: b.id, bookingCode: b.bookingCode, date: b.confirmedAt!, isDemo: b.isDemo, mimeType: 'application/pdf' }),
    );
  }
  if (want('FREIGHT_INVOICE')) {
    const rows = await prisma.invoice.findMany({
      where: { companyId, ...(filter.bookingId ? { bookingId: filter.bookingId } : {}), ...(range ? { issuedAt: range } : {}) },
      select: { id: true, invoiceNumber: true, issuedAt: true, status: true, booking: { select: { id: true, bookingCode: true, isDemo: true } } },
    });
    rows.forEach((i) =>
      items.push({ id: `FREIGHT_INVOICE:${i.id}`, type: 'FREIGHT_INVOICE', subType: i.status, title: 'Freight invoice', reference: i.invoiceNumber, bookingId: i.booking.id, bookingCode: i.booking.bookingCode, date: i.issuedAt, isDemo: i.booking.isDemo, mimeType: 'application/pdf' }),
    );
  }
  if (want('PAYMENT_RECEIPT')) {
    const rows = await prisma.payment.findMany({
      where: { companyId, receiptNumber: { not: null }, ...(filter.bookingId ? { bookingId: filter.bookingId } : {}), ...(range ? { paidAt: range } : {}) },
      select: { id: true, receiptNumber: true, paidAt: true, provider: true, booking: { select: { id: true, bookingCode: true, isDemo: true } } },
    });
    rows.forEach((p) =>
      items.push({ id: `PAYMENT_RECEIPT:${p.id}`, type: 'PAYMENT_RECEIPT', title: 'Payment receipt', reference: p.receiptNumber!, bookingId: p.booking.id, bookingCode: p.booking.bookingCode, date: p.paidAt!, isDemo: p.booking.isDemo || p.provider === 'MOCK', mimeType: 'application/pdf' }),
    );
  }
  if (want('TRIP_DOCUMENT')) {
    const rows = await prisma.tripDocument.findMany({
      where: { sharedWithCompany: true, booking: bookingWhere, ...(range ? { createdAt: range } : {}) },
      select: { id: true, type: true, title: true, createdAt: true, isDemo: true, mimeType: true, booking: { select: { id: true, bookingCode: true } } },
    });
    rows.forEach((d) =>
      items.push({ id: `TRIP_DOCUMENT:${d.id}`, type: 'TRIP_DOCUMENT', subType: d.type, title: d.title, reference: d.type.replace(/_/g, ' '), bookingId: d.booking.id, bookingCode: d.booking.bookingCode, date: d.createdAt, isDemo: d.isDemo, mimeType: d.mimeType }),
    );
  }
  return items.sort((a, b) => b.date.getTime() - a.date.getTime());
}

export type ResolvedDocument = { kind: 'buffer'; buffer: Buffer; fileName: string; mimeType: string } | { kind: 'stored'; storageKey: string; fileName: string; mimeType: string };

export async function resolveDocument(companyId: string, docId: string): Promise<ResolvedDocument> {
  const [type, id] = docId.split(':');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw AppError.notFound('Document not found');
  switch (type as DocumentType) {
    case 'BOOKING_CONFIRMATION':
      return { kind: 'buffer', mimeType: 'application/pdf', ...(await bookingConfirmationPdf(companyId, id)) };
    case 'BOOKING_SUMMARY':
      return { kind: 'buffer', mimeType: 'application/pdf', ...(await bookingSummaryPdf(companyId, id)) };
    case 'FREIGHT_INVOICE':
      return { kind: 'buffer', mimeType: 'application/pdf', ...(await invoicePdf(companyId, id)) };
    case 'PAYMENT_RECEIPT':
      return { kind: 'buffer', mimeType: 'application/pdf', ...(await receiptPdf(companyId, id)) };
    case 'TRIP_DOCUMENT': {
      const doc = await prisma.tripDocument.findFirst({ where: { id, sharedWithCompany: true, booking: { companyId } } });
      if (!doc) throw AppError.notFound('Document not found');
      return { kind: 'stored', storageKey: doc.storageKey, fileName: doc.fileName, mimeType: doc.mimeType };
    }
    default:
      throw AppError.notFound('Document not found');
  }
}
