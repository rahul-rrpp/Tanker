import { Prisma, type CompanyDocumentType } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { storage } from '../../lib/storage';
import type { StoredFile } from '../../middleware/upload';
import { AppError } from '../../utils/errors';
import { validateGstin } from '../../utils/gst';
import { emailSchema, fullNameSchema, panSchema, phoneSchema, pincodeSchema } from '../../utils/validators';
import { audit } from '../audit/audit';
import { ACTIVE_TRIP_STATUSES, COMPLETED_STATUSES, PENDING_STATUSES } from '../bookings/booking.common';

const addressSchema = z.object({
  address: z.string().trim().min(5, 'Address is required').max(300),
  city: z.string().trim().min(2, 'City is required').max(80),
  state: z.string().trim().min(2, 'State is required').max(80),
  pincode: pincodeSchema,
  country: z.string().trim().min(2).max(60).default('India'),
});

const optionalUrl = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`) : undefined))
  .pipe(z.string().url('Enter a valid website').optional());

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    panNumber: panSchema.optional().or(z.literal('').transform(() => undefined)),
    businessType: z.enum(['MANUFACTURER', 'TRADER', 'DISTRIBUTOR', 'OIL_MARKETING_COMPANY', 'REFINERY', 'PETROL_PUMP_DEALER', 'INDUSTRIAL_CONSUMER', 'LOGISTICS_PROVIDER', 'OTHER']),
    industry: z.string().trim().max(80).optional().transform((v) => v || undefined),
    website: optionalUrl,
    contactPersonName: fullNameSchema,
    contactPhone: phoneSchema,
    contactEmail: emailSchema,
    registeredAddress: addressSchema,
    billingSameAsRegistered: z.boolean(),
    billingAddress: addressSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.billingSameAsRegistered && !v.billingAddress) ctx.addIssue({ code: 'custom', path: ['billingAddress'], message: 'Enter the billing address' });
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const REQUIRED_DOCUMENTS: CompanyDocumentType[] = ['GST_CERTIFICATE', 'PAN_CARD'];

export async function getProfile(companyId: string) {
  const c = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    include: {
      addresses: true,
      contacts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
      documents: { where: { isCurrent: true }, orderBy: { createdAt: 'desc' }, select: { id: true, type: true, title: true, fileName: true, mimeType: true, sizeBytes: true, status: true, reviewNote: true, createdAt: true } },
      _count: { select: { bookings: true, savedLocations: true } },
    },
  });
  const { logoKey, addresses, ...rest } = c;
  const uploadedTypes = new Set(c.documents.map((d) => d.type));
  return {
    ...rest,
    hasLogo: Boolean(logoKey),
    registeredAddress: addresses.find((a) => a.type === 'REGISTERED') ?? null,
    billingAddress: addresses.find((a) => a.type === 'BILLING') ?? null,
    verification: {
      status: c.status,
      reason: c.statusReason,
      verifiedAt: c.verifiedAt,
      missingDocuments: REQUIRED_DOCUMENTS.filter((t) => !uploadedTypes.has(t)),
    },
  };
}

export async function updateProfile(companyId: string, userId: string, input: UpdateProfileInput, req?: Request) {
  const current = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  if (input.panNumber) {
    const gst = validateGstin(current.gstNumber);
    if (gst.valid && gst.pan !== input.panNumber) throw AppError.badRequest('PAN does not match your GSTIN', undefined, [{ field: 'panNumber', message: 'PAN must match characters 3-12 of your GSTIN' }]);
  }
  const { registeredAddress, billingAddress, ...fields } = input;
  await prisma.$transaction(async (tx) => {
    await tx.company.update({ where: { id: companyId }, data: { ...fields, website: fields.website ?? null, industry: fields.industry ?? null } });
    await tx.companyAddress.upsert({
      where: { companyId_type: { companyId, type: 'REGISTERED' } },
      update: registeredAddress,
      create: { ...registeredAddress, companyId, type: 'REGISTERED' },
    });
    if (!input.billingSameAsRegistered && billingAddress) {
      await tx.companyAddress.upsert({
        where: { companyId_type: { companyId, type: 'BILLING' } },
        update: billingAddress,
        create: { ...billingAddress, companyId, type: 'BILLING' },
      });
    }
    const primary = await tx.companyContact.findFirst({ where: { companyId, isPrimary: true } });
    const contact = { name: input.contactPersonName, phone: input.contactPhone, email: input.contactEmail };
    if (primary) await tx.companyContact.update({ where: { id: primary.id }, data: contact });
    else await tx.companyContact.create({ data: { ...contact, companyId, isPrimary: true } });
    await audit({ action: 'company.profile_updated', entityType: 'company', entityId: companyId, companyId, actorUserId: userId, metadata: { fields: Object.keys(fields) }, req }, tx);
  });
  return getProfile(companyId);
}

export async function setLogo(companyId: string, userId: string, file: StoredFile, req?: Request) {
  const old = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { logoKey: true } });
  await prisma.company.update({ where: { id: companyId }, data: { logoKey: file.storageKey } });
  if (old.logoKey) await storage.remove(old.logoKey).catch(() => undefined);
  await audit({ action: 'company.logo_updated', entityType: 'company', entityId: companyId, companyId, actorUserId: userId, req });
}

export async function getLogo(companyId: string) {
  const c = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { logoKey: true } });
  if (!c.logoKey) throw AppError.notFound('No logo uploaded');
  const ext = c.logoKey.split('.').pop();
  return { storageKey: c.logoKey, fileName: `logo.${ext}`, mimeType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' };
}

export async function addDocument(companyId: string, userId: string, input: { type: CompanyDocumentType; title?: string }, file: StoredFile, req?: Request) {
  const doc = await prisma.$transaction(async (tx) => {
    // Replacing keeps history: older versions stay in the table with isCurrent=false.
    if (input.type !== 'OTHER') await tx.companyDocument.updateMany({ where: { companyId, type: input.type, isCurrent: true }, data: { isCurrent: false } });
    const created = await tx.companyDocument.create({
      data: { companyId, type: input.type, title: input.title, ...file, uploadedById: userId, status: 'UPLOADED' },
    });
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { status: true } });
    if (company.status === 'REJECTED') {
      // Re-submission puts the company back in the verification queue.
      await tx.company.update({ where: { id: companyId }, data: { status: 'PENDING_VERIFICATION', statusReason: null } });
    }
    await audit({ action: 'company.document_uploaded', entityType: 'company_document', entityId: created.id, companyId, actorUserId: userId, metadata: { type: input.type, sizeBytes: file.sizeBytes }, req }, tx);
    return created;
  });
  return doc;
}

export async function listDocuments(companyId: string, includeHistory: boolean) {
  return prisma.companyDocument.findMany({
    where: { companyId, ...(includeHistory ? {} : { isCurrent: true }) },
    orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
    select: { id: true, type: true, title: true, fileName: true, mimeType: true, sizeBytes: true, status: true, reviewNote: true, isCurrent: true, createdAt: true },
  });
}

export async function getDocumentFile(companyId: string, id: string) {
  const d = await prisma.companyDocument.findFirst({ where: { id, companyId } });
  if (!d) throw AppError.notFound('Document not found');
  return d;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function dashboard(companyId: string, userId?: string) {
  const [statusCounts, activeTrips, expense, recent, statusEvents, negotiationEvents] = await Promise.all([
    prisma.booking.groupBy({ by: ['status'], where: { companyId }, _count: { _all: true } }),
    prisma.trip.count({ where: { booking: { companyId }, status: { in: ['SCHEDULED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'LOADING', 'IN_TRANSIT'] } } }),
    prisma.booking.aggregate({ where: { companyId, acceptedFreight: { not: null }, status: { not: 'CANCELLED' } }, _sum: { acceptedFreight: true }, _avg: { acceptedFreight: true }, _count: { _all: true } }),
    prisma.booking.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true, bookingCode: true, status: true, createdAt: true, customerOffer: true, acceptedFreight: true, isDemo: true,
        locations: { select: { type: true, city: true, address: true } },
        requirement: { select: { tankerCapacityKl: true, numberOfTankers: true } },
        product: { select: { name: true } },
      },
    }),
    prisma.bookingStatusHistory.findMany({
      where: { booking: { companyId } },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { id: true, toStatus: true, note: true, createdAt: true, booking: { select: { id: true, bookingCode: true } } },
    }),
    prisma.offerNegotiationHistory.findMany({
      where: { booking: { companyId }, party: 'TRANSPORTER' },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { id: true, action: true, amount: true, createdAt: true, isDemo: true, booking: { select: { id: true, bookingCode: true } }, offer: { select: { transporter: { select: { companyName: true } } } } },
    }),
  ]);

  const [pendingOffers, recentNotifications, frequentRoutes] = await Promise.all([
    prisma.transporterOffer.count({ where: { booking: { companyId }, status: 'PENDING', expiresAt: { gt: new Date() } } }),
    userId
      ? prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, type: true, title: true, message: true, link: true, readAt: true, createdAt: true } })
      : Promise.resolve([]),
    prisma.$queryRaw<{ pickup: string | null; delivery: string | null; bookings: bigint; last_booking_id: string; last_at: Date; avg_freight: Prisma.Decimal | null }[]>`
      SELECT p.city AS pickup, d.city AS delivery, COUNT(*) AS bookings,
             (array_agg(b.id ORDER BY b."createdAt" DESC))[1]::text AS last_booking_id,
             MAX(b."createdAt") AS last_at, AVG(b."acceptedFreight") AS avg_freight
        FROM bookings b
        JOIN booking_locations p ON p."bookingId" = b.id AND p.type = 'PICKUP'
        JOIN booking_locations d ON d."bookingId" = b.id AND d.type = 'DELIVERY'
       WHERE b."companyId" = ${companyId}::uuid
       GROUP BY 1, 2 ORDER BY bookings DESC, last_at DESC LIMIT 5`,
  ]);
  const count = (statuses: readonly string[]) => statusCounts.filter((s) => statuses.includes(s.status)).reduce((n, s) => n + s._count._all, 0);
  const total = statusCounts.reduce((n, s) => n + s._count._all, 0);

  type MonthRow = { month: string; spend: Prisma.Decimal | null; trips: bigint };
  const monthly = await prisma.$queryRaw<MonthRow[]>`
    SELECT to_char(date_trunc('month', ("confirmedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month,
           SUM("acceptedFreight") AS spend, COUNT(*) AS trips
      FROM bookings
     WHERE "companyId" = ${companyId}::uuid AND "acceptedFreight" IS NOT NULL AND status <> 'CANCELLED'
       AND "confirmedAt" >= (now() - interval '12 months')
     GROUP BY 1 ORDER BY 1`;
  type CountRow = { month: string; bookings: bigint };
  const monthlyCounts = await prisma.$queryRaw<CountRow[]>`
    SELECT to_char(date_trunc('month', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month, COUNT(*) AS bookings
      FROM bookings WHERE "companyId" = ${companyId}::uuid AND "createdAt" >= (now() - interval '12 months')
     GROUP BY 1 ORDER BY 1`;
  type RouteRow = { pickup: string | null; delivery: string | null; spend: Prisma.Decimal; trips: bigint };
  const routes = await prisma.$queryRaw<RouteRow[]>`
    SELECT p.city AS pickup, d.city AS delivery, SUM(b."acceptedFreight") AS spend, COUNT(*) AS trips
      FROM bookings b
      JOIN booking_locations p ON p."bookingId" = b.id AND p.type = 'PICKUP'
      JOIN booking_locations d ON d."bookingId" = b.id AND d.type = 'DELIVERY'
     WHERE b."companyId" = ${companyId}::uuid AND b."acceptedFreight" IS NOT NULL AND b.status <> 'CANCELLED'
     GROUP BY 1, 2 ORDER BY spend DESC LIMIT 6`;

  // Continuous last-6-month axis (months with no activity show as zero).
  const months: string[] = [];
  const nowIst = new Date(Date.now() + 5.5 * 3600_000);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth() - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const spendBy = new Map(monthly.map((m) => [m.month, m]));
  const countBy = new Map(monthlyCounts.map((m) => [m.month, Number(m.bookings)]));

  const activities = [
    ...statusEvents.map((e) => ({
      id: `s-${e.id}`,
      kind: e.toStatus,
      bookingId: e.booking.id,
      bookingCode: e.booking.bookingCode,
      text: e.note ?? e.toStatus.replace(/_/g, ' ').toLowerCase(),
      at: e.createdAt,
      demo: false,
    })),
    ...negotiationEvents.map((e) => ({
      id: `n-${e.id}`,
      kind: e.action === 'COUNTER_OFFER' ? 'COUNTER_OFFER_RECEIVED' : 'OFFER_RECEIVED',
      bookingId: e.booking.id,
      bookingCode: e.booking.bookingCode,
      text: `${e.offer.transporter.companyName} ${e.action === 'COUNTER_OFFER' ? 'sent a counter-offer' : e.action === 'CUSTOMER_PRICE_ACCEPTED' ? 'accepted your price' : 'sent an offer'}${e.amount ? ` of Rs ${e.amount.toNumber().toLocaleString('en-IN')}` : ''}`,
      at: e.createdAt,
      demo: e.isDemo,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 10);

  return {
    summary: {
      totalBookings: total,
      pendingBookings: count(PENDING_STATUSES),
      activeTrips,
      activeBookings: count(ACTIVE_TRIP_STATUSES),
      completedTrips: count(COMPLETED_STATUSES),
      cancelledBookings: count(['CANCELLED']),
      offersReceived: pendingOffers,
      confirmedBookings: count(['CONFIRMED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'LOADING']),
      totalTransportExpense: expense._sum.acceptedFreight ?? new Prisma.Decimal(0),
      averageFreightPerTrip: expense._avg.acceptedFreight ? expense._avg.acceptedFreight.toDecimalPlaces(0) : new Prisma.Decimal(0),
      confirmedTrips: expense._count._all,
    },
    recentBookings: recent.map((b) => ({
      id: b.id,
      bookingCode: b.bookingCode,
      status: b.status,
      createdAt: b.createdAt,
      isDemo: b.isDemo,
      product: b.product.name,
      pickup: b.locations.find((l) => l.type === 'PICKUP')?.city ?? b.locations.find((l) => l.type === 'PICKUP')?.address ?? '-',
      delivery: b.locations.find((l) => l.type === 'DELIVERY')?.city ?? b.locations.find((l) => l.type === 'DELIVERY')?.address ?? '-',
      tankerCapacityKl: b.requirement?.tankerCapacityKl ?? null,
      numberOfTankers: b.requirement?.numberOfTankers ?? null,
      customerOffer: b.customerOffer,
      acceptedFreight: b.acceptedFreight,
    })),
    activities,
    lastBookingId: recent[0]?.id ?? null,
    statusOverview: [
      { key: 'searching', label: 'Searching', value: count(['SEARCHING', 'OFFERS_RECEIVED']) },
      { key: 'negotiation', label: 'Negotiation', value: count(['NEGOTIATION']) },
      { key: 'confirmed', label: 'Confirmed', value: count(['CONFIRMED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'LOADING']) },
      { key: 'in_transit', label: 'In transit', value: count(['IN_TRANSIT']) },
      { key: 'completed', label: 'Completed', value: count(['DELIVERED', 'COMPLETED']) },
      { key: 'cancelled', label: 'Cancelled', value: count(['CANCELLED']) },
    ],
    recentNotifications,
    frequentRoutes: frequentRoutes.map((r) => ({
      route: `${r.pickup ?? '?'} → ${r.delivery ?? '?'}`,
      bookings: Number(r.bookings),
      lastBookingId: r.last_booking_id,
      lastAt: r.last_at,
      averageFreight: r.avg_freight ? new Prisma.Decimal(r.avg_freight).toDecimalPlaces(0).toNumber() : null,
    })),
    analytics: {
      monthly: months.map((m) => ({
        month: m,
        spend: spendBy.get(m)?.spend?.toNumber() ?? 0,
        trips: Number(spendBy.get(m)?.trips ?? 0),
        bookings: countBy.get(m) ?? 0,
      })),
      routes: routes.map((r) => ({ route: `${r.pickup ?? '?'} → ${r.delivery ?? '?'}`, spend: new Prisma.Decimal(r.spend).toNumber(), trips: Number(r.trips) })),
    },
  };
}
