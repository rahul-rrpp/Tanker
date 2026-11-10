import { logger } from '../../lib/logger';
import { alertTransporters } from '../transporter/alerts.service';
import { Prisma, type BookingStatus } from '@prisma/client';
import type { Request } from 'express';
import { nextCode } from '../../lib/codes';
import { round2 } from '../../lib/money';
import { prisma } from '../../lib/prisma';
import { AppError, ErrorCode } from '../../utils/errors';
import { audit } from '../audit/audit';
import { computeRoutes } from '../maps/maps.service';
import { notify } from '../notifications/notification.service';
import { estimateFreight } from '../pricing/pricing.service';
import { getSettings } from '../settings/settings.service';
import { BOOKING_TABS, CANCELLABLE, lockBooking, OPEN_FOR_OFFERS, setBookingStatus, todayIst, type BookingTab } from './booking.common';
import type { CreateBookingInput, ListBookingsInput, UpdateBookingInput } from './booking.schemas';
import { expireStaleOffers } from '../offers/offer.service';

const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);

export const bookingDetailInclude = {
  product: { select: { id: true, code: true, name: true } },
  locations: { orderBy: [{ type: 'asc' }, { sequence: 'asc' }] },
  requirement: { include: { tankerType: { select: { id: true, code: true, name: true } } } },
  statusHistory: { orderBy: { createdAt: 'asc' } },
  allocations: {
    include: { transporter: { select: { id: true, companyName: true, rating: true, completedTrips: true, verificationStatus: true, isDemo: true, city: true, state: true } } },
  },
  trips: {
    select: {
      id: true, tripCode: true, allocationId: true, status: true, isSimulated: true, startedAt: true, deliveredAt: true, completedAt: true, etaAt: true,
      tanker: { select: { registrationNumber: true, capacityKl: true } },
      driver: { select: { user: { select: { fullName: true, phone: true } } } },
    },
  },
  invoices: { select: { id: true, invoiceNumber: true, totalAmount: true, status: true, issuedAt: true } },
  payments: { orderBy: { createdAt: 'desc' }, select: { id: true, purpose: true, amount: true, status: true, receiptNumber: true, paidAt: true, createdAt: true, provider: true } },
  _count: { select: { offers: true } },
} satisfies Prisma.BookingInclude;

async function assertOwnedSavedLocation(companyId: string, id?: string) {
  if (!id) return;
  const found = await prisma.savedLocation.findFirst({ where: { id, companyId }, select: { id: true } });
  if (!found) throw AppError.badRequest('Saved location not found');
}

function validateOfferRange(offer: number, range: { offerMin: Prisma.Decimal; offerMax: Prisma.Decimal }) {
  if (new Prisma.Decimal(offer).lessThan(range.offerMin) || new Prisma.Decimal(offer).greaterThan(range.offerMax)) {
    throw AppError.badRequest(
      `Your offer must be between Rs ${range.offerMin.toNumber().toLocaleString('en-IN')} and Rs ${range.offerMax.toNumber().toLocaleString('en-IN')}`,
      ErrorCode.OFFER_OUT_OF_RANGE,
      [{ field: 'customerOffer', message: 'Offer is outside the allowed range' }],
    );
  }
}

/** Route + freight quote used by the booking form (and re-computed server-side on submit). */
export async function quote(input: {
  pickup: { latitude: number; longitude: number; state?: string };
  delivery: { latitude: number; longitude: number; state?: string };
  routeIndex: number;
  productId: string;
  tankerCapacityKl: number;
  numberOfTankers: number;
  tankerTypeId?: string;
}) {
  const product = await prisma.product.findFirst({ where: { id: input.productId, isActive: true } });
  if (!product) throw AppError.badRequest('Selected product is not available');
  const settings = await getSettings();
  if (input.numberOfTankers > settings.maxTankersPerBooking) {
    throw AppError.badRequest(`A single booking can request at most ${settings.maxTankersPerBooking} tankers`);
  }
  const routes = await computeRoutes(
    { lat: input.pickup.latitude, lng: input.pickup.longitude },
    { lat: input.delivery.latitude, lng: input.delivery.longitude },
  );
  const route = routes.routes[input.routeIndex] ?? routes.routes[0];
  const estimate = await estimateFreight({
    distanceKm: route.distanceKm,
    capacityKl: input.tankerCapacityKl,
    productId: input.productId,
    tankerTypeId: input.tankerTypeId,
    originState: input.pickup.state,
    destState: input.delivery.state,
    numberOfTankers: input.numberOfTankers,
  });
  return { routes, route, estimate, product, settings };
}

export async function createBooking(
  companyId: string,
  userId: string,
  input: CreateBookingInput,
  req?: Request,
  opts: { repeatedFromId?: string; source?: 'PORTAL' | 'ADMIN_ASSISTED'; customerAuthorization?: Prisma.InputJsonValue } = {},
) {
  if (input.loadingDate < todayIst()) {
    throw AppError.badRequest('Loading date cannot be in the past', ErrorCode.VALIDATION_ERROR, [{ field: 'loadingDate', message: 'Choose today or a future date' }]);
  }
  await assertOwnedSavedLocation(companyId, input.pickup.savedLocationId);
  await assertOwnedSavedLocation(companyId, input.delivery.savedLocationId);
  if (input.tankerTypeId && !(await prisma.tankerType.findFirst({ where: { id: input.tankerTypeId, isActive: true } }))) {
    throw AppError.badRequest('Selected tanker type is not available');
  }

  // Distance, duration and suggested freight are always computed here, never taken from the client.
  const { routes, route, estimate, product, settings } = await quote(input);
  validateOfferRange(input.customerOffer, estimate);

  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { isDemo: true } });
  const booking = await prisma.$transaction(async (tx) => {
    const created = await tx.booking.create({
      data: {
        bookingCode: await nextCode(tx, 'booking'),
        companyId,
        createdById: userId,
        status: 'SEARCHING',
        productId: product.id,
        distanceKm: route.distanceKm,
        durationMinutes: route.durationMinutes,
        routePolyline: route.polyline,
        routeSummary: route.summary.slice(0, 200),
        routeProvider: routes.provider,
        pricingRuleId: estimate.ruleId,
        ratePerKm: estimate.ratePerKm,
        suggestedFreight: estimate.suggestedFreight,
        customerOffer: round2(input.customerOffer),
        loadingDate: dateOnly(input.loadingDate),
        loadingTime: input.loadingTime,
        loadingContactName: input.loadingContactName,
        loadingContactPhone: input.loadingContactPhone,
        loadingInstructions: input.loadingInstructions,
        expectedDeliveryDate: dateOnly(input.expectedDeliveryDate),
        deliveryContactName: input.deliveryContactName,
        deliveryContactPhone: input.deliveryContactPhone,
        deliveryInstructions: input.deliveryInstructions,
        offerExpiryHours: settings.offerExpiryHours,
        repeatedFromId: opts.repeatedFromId,
        source: opts.source ?? 'PORTAL',
        customerAuthorization: opts.customerAuthorization,
        isDemo: company.isDemo,
        locations: {
          create: (['PICKUP', 'DELIVERY'] as const).map((type) => {
            const l = type === 'PICKUP' ? input.pickup : input.delivery;
            return {
              type,
              address: l.address,
              placeId: l.placeId,
              latitude: l.latitude,
              longitude: l.longitude,
              city: l.city,
              state: l.state,
              pincode: l.pincode,
              savedLocationId: l.savedLocationId,
            };
          }),
        },
        requirement: {
          create: {
            tankerCapacityKl: input.tankerCapacityKl,
            quantityKl: input.quantityKl,
            numberOfTankers: input.numberOfTankers,
            tankerTypeId: input.tankerTypeId,
            compartmentRequirement: input.compartmentRequirement,
            productCompatibility: input.productCompatibility,
            specialRequirements: input.specialRequirements,
          },
        },
        statusHistory: { create: { toStatus: 'SEARCHING', actorType: opts.source === 'ADMIN_ASSISTED' ? 'EMPLOYEE' : 'COMPANY', actorUserId: userId, note: opts.source === 'ADMIN_ASSISTED' ? 'Booking created by TankerLink on the company’s behalf' : 'Booking created' } },
      },
    });
    await audit(
      {
        action: 'booking.created',
        entityType: 'booking',
        entityId: created.id,
        companyId,
        actorUserId: userId,
        metadata: { bookingCode: created.bookingCode, distanceKm: route.distanceKm, suggestedFreight: estimate.suggestedFreight.toNumber(), customerOffer: input.customerOffer, routeProvider: routes.provider },
        req,
      },
      tx,
    );
    return created;
  });

  await notify({
    companyId,
    type: 'BOOKING_CREATED',
    title: `Booking ${booking.bookingCode} created`,
    message: `We are looking for tankers for your ${product.name} load (${route.distanceKm} km). You will be notified when transporters respond.`,
    bookingId: booking.id,
  });
  void alertTransporters(booking.id).catch((err) => logger.error({ err }, 'New booking alerts failed'));
  return getBooking(companyId, booking.id);
}

export async function getBooking(companyId: string, bookingId: string) {
  await expireStaleOffers({ bookingId });
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, companyId }, include: bookingDetailInclude });
  if (!booking) throw AppError.notFound('Booking not found');
  const openOffers = await prisma.transporterOffer.findMany({
    where: { bookingId, status: { in: ['PENDING', 'COUNTERED'] } },
    select: { currentAmount: true, status: true },
  });
  const best = openOffers.reduce<Prisma.Decimal | null>((m, o) => (m === null || o.currentAmount.lessThan(m) ? o.currentAmount : m), null);
  return {
    ...booking,
    pickup: booking.locations.find((l) => l.type === 'PICKUP') ?? null,
    delivery: booking.locations.find((l) => l.type === 'DELIVERY') ?? null,
    offersCount: booking._count.offers,
    openOffersCount: openOffers.length,
    bestOffer: best,
    tankersAllocated: booking.allocations.filter((a) => a.status !== 'CANCELLED').reduce((n, a) => n + a.tankersAllocated, 0),
    canEdit: booking.status === 'SEARCHING' && booking._count.offers === 0,
    canCancel: CANCELLABLE.includes(booking.status),
  };
}

export async function listBookings(companyId: string, input: ListBookingsInput) {
  const where: Prisma.BookingWhereInput = { companyId };
  const statuses = BOOKING_TABS[input.tab as BookingTab];
  if (statuses) where.status = { in: [...statuses] };
  if (input.productId) where.productId = input.productId;
  if (input.capacity) where.requirement = { tankerCapacityKl: input.capacity };
  if (input.status) where.status = input.status;
  const cityFilters: Prisma.BookingWhereInput[] = [];
  if (input.pickupCity) cityFilters.push({ locations: { some: { type: 'PICKUP', city: { contains: input.pickupCity, mode: 'insensitive' } } } });
  if (input.deliveryCity) cityFilters.push({ locations: { some: { type: 'DELIVERY', city: { contains: input.deliveryCity, mode: 'insensitive' } } } });
  if (cityFilters.length) where.AND = cityFilters;
  if (input.from || input.to) {
    where.createdAt = {
      ...(input.from ? { gte: new Date(`${input.from}T00:00:00+05:30`) } : {}),
      ...(input.to ? { lte: new Date(`${input.to}T23:59:59.999+05:30`) } : {}),
    };
  }
  if (input.q) {
    where.OR = [
      { bookingCode: { contains: input.q, mode: 'insensitive' } },
      { locations: { some: { OR: [{ address: { contains: input.q, mode: 'insensitive' } }, { city: { contains: input.q, mode: 'insensitive' } }] } } },
    ];
  }

  const [total, rows, counts] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: {
        product: { select: { name: true } },
        locations: { select: { type: true, address: true, city: true, state: true } },
        requirement: { select: { tankerCapacityKl: true, numberOfTankers: true, quantityKl: true } },
        offers: { where: { status: { in: ['PENDING', 'COUNTERED'] } }, select: { currentAmount: true } },
        allocations: { where: { status: { not: 'CANCELLED' } }, select: { tankersAllocated: true } },
        _count: { select: { offers: true } },
      },
    }),
    prisma.booking.groupBy({ by: ['status'], where: { companyId }, _count: { _all: true } }),
  ]);

  const byStatus = new Map(counts.map((c) => [c.status, c._count._all]));
  const tabCounts = Object.fromEntries(
    Object.entries(BOOKING_TABS).map(([tab, sts]) => [
      tab,
      sts ? sts.reduce((n, s) => n + (byStatus.get(s as BookingStatus) ?? 0), 0) : [...byStatus.values()].reduce((a, b) => a + b, 0),
    ]),
  );

  return {
    total,
    page: input.page,
    pageSize: input.pageSize,
    tabCounts,
    items: rows.map((b) => {
      const pickup = b.locations.find((l) => l.type === 'PICKUP');
      const delivery = b.locations.find((l) => l.type === 'DELIVERY');
      const best = b.offers.reduce<Prisma.Decimal | null>((m, o) => (m === null || o.currentAmount.lessThan(m) ? o.currentAmount : m), null);
      return {
        id: b.id,
        bookingCode: b.bookingCode,
        createdAt: b.createdAt,
        loadingDate: b.loadingDate,
        status: b.status,
        isDemo: b.isDemo,
        product: b.product.name,
        pickup: pickup ? { address: pickup.address, city: pickup.city, state: pickup.state } : null,
        delivery: delivery ? { address: delivery.address, city: delivery.city, state: delivery.state } : null,
        tankerCapacityKl: b.requirement?.tankerCapacityKl ?? null,
        numberOfTankers: b.requirement?.numberOfTankers ?? null,
        quantityKl: b.requirement?.quantityKl ?? null,
        tankersAllocated: b.allocations.reduce((n, a) => n + a.tankersAllocated, 0),
        distanceKm: b.distanceKm,
        customerOffer: b.customerOffer,
        suggestedFreight: b.suggestedFreight,
        acceptedFreight: b.acceptedFreight,
        bestOffer: best,
        offersCount: b._count.offers,
        openOffersCount: b.offers.length,
        canEdit: b.status === 'SEARCHING' && b._count.offers === 0,
        canCancel: CANCELLABLE.includes(b.status),
      };
    }),
  };
}

export async function updateBooking(companyId: string, userId: string, bookingId: string, input: UpdateBookingInput, req?: Request) {
  const { version, customerOffer, loadingDate, expectedDeliveryDate, ...rest } = input;
  const current = await prisma.booking.findFirst({ where: { id: bookingId, companyId }, include: { _count: { select: { offers: true } } } });
  if (!current) throw AppError.notFound('Booking not found');
  if (current.status !== 'SEARCHING' || current._count.offers > 0) {
    throw AppError.conflict('This booking can no longer be edited because transporters have already responded', ErrorCode.INVALID_STATE_TRANSITION);
  }
  const newLoading = loadingDate ?? current.loadingDate.toISOString().slice(0, 10);
  const newDelivery = expectedDeliveryDate ?? current.expectedDeliveryDate.toISOString().slice(0, 10);
  if (loadingDate && loadingDate < todayIst()) throw AppError.badRequest('Loading date cannot be in the past');
  if (newDelivery < newLoading) throw AppError.badRequest('Delivery date cannot be before the loading date');
  if (customerOffer !== undefined) {
    const settings = await getSettings();
    validateOfferRange(customerOffer, {
      offerMin: round2(current.suggestedFreight.times(settings.offerMinPercentOfSuggested).dividedBy(100)),
      offerMax: round2(current.suggestedFreight.times(settings.offerMaxPercentOfSuggested).dividedBy(100)),
    });
  }
  const { specialRequirements, ...bookingFields } = rest;
  await prisma.$transaction(async (tx) => {
    // Optimistic concurrency: the edit applies only to the version the user was looking at.
    const updated = await tx.booking.updateMany({
      where: { id: bookingId, companyId, version, status: 'SEARCHING' },
      data: {
        ...bookingFields,
        ...(customerOffer !== undefined ? { customerOffer: round2(customerOffer) } : {}),
        ...(loadingDate ? { loadingDate: dateOnly(loadingDate) } : {}),
        ...(expectedDeliveryDate ? { expectedDeliveryDate: dateOnly(expectedDeliveryDate) } : {}),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw AppError.conflict('This booking was changed in the meantime. Reload and try again.');
    if (specialRequirements !== undefined) await tx.bookingRequirement.update({ where: { bookingId }, data: { specialRequirements } });
    await audit({ action: 'booking.updated', entityType: 'booking', entityId: bookingId, companyId, actorUserId: userId, metadata: { fields: Object.keys(input).filter((k) => k !== 'version') }, req }, tx);
  });
  return getBooking(companyId, bookingId);
}

export async function cancelBooking(companyId: string, userId: string, bookingId: string, reason: string, req?: Request) {
  const result = await prisma.$transaction(async (tx) => {
    const booking = await lockBooking(tx, bookingId, companyId);
    if (!CANCELLABLE.includes(booking.status)) {
      throw AppError.conflict(
        booking.status === 'CANCELLED' ? 'This booking is already cancelled' : 'Bookings cannot be cancelled once a vehicle is assigned. Raise a support ticket instead.',
        ErrorCode.INVALID_STATE_TRANSITION,
      );
    }
    const open = await tx.transporterOffer.findMany({ where: { bookingId, status: { in: ['PENDING', 'COUNTERED'] } }, select: { id: true, isDemo: true } });
    if (open.length) {
      await tx.transporterOffer.updateMany({ where: { id: { in: open.map((o) => o.id) } }, data: { status: 'UNSUCCESSFUL', closedAt: new Date(), version: { increment: 1 } } });
      await tx.offerNegotiationHistory.createMany({
        data: open.map((o) => ({ offerId: o.id, bookingId, party: 'SYSTEM' as const, action: 'CLOSED' as const, message: 'Booking cancelled by company', isDemo: o.isDemo })),
      });
    }
    await tx.bookingAllocation.updateMany({ where: { bookingId, status: { not: 'CANCELLED' } }, data: { status: 'CANCELLED' } });
    await tx.trip.updateMany({ where: { bookingId, status: { notIn: ['COMPLETED', 'CANCELLED'] } }, data: { status: 'CANCELLED' } });

    const paid = await tx.payment.count({ where: { bookingId, status: 'PAID' } });
    await tx.payment.updateMany({ where: { bookingId, status: 'CREATED' }, data: { status: 'FAILED', failureReason: 'Booking cancelled' } });
    if (paid > 0) {
      await tx.payment.updateMany({ where: { bookingId, status: 'PAID' }, data: { status: 'REFUND_PENDING' } });
    } else {
      await tx.invoice.updateMany({ where: { bookingId, status: { not: 'CANCELLED' } }, data: { status: 'CANCELLED' } });
    }
    await setBookingStatus(tx, booking, 'CANCELLED', { type: 'COMPANY', userId, note: reason }, {
      cancelledAt: new Date(),
      cancellationReason: reason,
      ...(paid > 0 ? { paymentStatus: 'REFUND_PENDING' } : {}),
    });
    await audit({ action: 'booking.cancelled', entityType: 'booking', entityId: bookingId, companyId, actorUserId: userId, metadata: { reason, refundPending: paid > 0 }, req }, tx);
    return { bookingCode: booking.bookingCode, refundPending: paid > 0 };
  });

  await notify({
    companyId,
    type: 'BOOKING_CANCELLED',
    title: `Booking ${result.bookingCode} cancelled`,
    message: result.refundPending ? 'Your booking was cancelled. Payments already made are marked for refund.' : 'Your booking was cancelled. All pending transporter offers were closed.',
    bookingId,
  });
  return getBooking(companyId, bookingId);
}

/** Pre-fills a new booking from an earlier one (dates are cleared so the company picks new ones). */
export async function repeatTemplate(companyId: string, bookingId: string) {
  const b = await prisma.booking.findFirst({ where: { id: bookingId, companyId }, include: { locations: true, requirement: true, product: true } });
  if (!b) throw AppError.notFound('Booking not found');
  const loc = (type: 'PICKUP' | 'DELIVERY') => {
    const l = b.locations.find((x) => x.type === type)!;
    return {
      address: l.address,
      placeId: l.placeId ?? undefined,
      latitude: l.latitude.toNumber(),
      longitude: l.longitude.toNumber(),
      city: l.city ?? undefined,
      state: l.state ?? undefined,
      pincode: l.pincode ?? undefined,
      savedLocationId: l.savedLocationId ?? undefined,
    };
  };
  return {
    repeatedFromId: b.id,
    repeatedFromCode: b.bookingCode,
    pickup: loc('PICKUP'),
    delivery: loc('DELIVERY'),
    productId: b.productId,
    tankerCapacityKl: b.requirement?.tankerCapacityKl.toNumber(),
    quantityKl: b.requirement?.quantityKl.toNumber(),
    numberOfTankers: b.requirement?.numberOfTankers,
    tankerTypeId: b.requirement?.tankerTypeId ?? undefined,
    compartmentRequirement: b.requirement?.compartmentRequirement ?? 'ANY',
    productCompatibility: b.requirement?.productCompatibility,
    specialRequirements: b.requirement?.specialRequirements ?? undefined,
    loadingTime: b.loadingTime,
    loadingContactName: b.loadingContactName,
    loadingContactPhone: b.loadingContactPhone,
    loadingInstructions: b.loadingInstructions ?? undefined,
    deliveryContactName: b.deliveryContactName,
    deliveryContactPhone: b.deliveryContactPhone,
    deliveryInstructions: b.deliveryInstructions ?? undefined,
    previousOffer: b.customerOffer.toNumber(),
    previousAcceptedFreight: b.acceptedFreight?.toNumber() ?? null,
  };
}

export { OPEN_FOR_OFFERS };
