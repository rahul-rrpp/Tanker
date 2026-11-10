/**
 * Transporter Portal demo data (development only):  npm run db:seed:transporter
 * Run after db:seed:demo. Purely additive: it inserts new isDemo rows and never updates or deletes an
 * existing record. Refuses production, and does nothing if it has already run.
 *
 *   Verified transporter  9200000001   Pending transporter  9200000002   Suspended transporter  9200000003
 *   Driver (OTP login)    9200000011   Password for the transporter logins: Demo@12345
 */
import 'dotenv/config';
import { Prisma, PrismaClient, type BookingStatus, type OfferStatus, type RoleName, type TripStatus } from '@prisma/client';
import { hashPassword } from '../src/modules/auth/password.service';
import { commissionForAllocation } from '../src/modules/admin/commission.service';
import { buildGstin } from '../src/utils/gst';
import { encodePolyline, type LatLng } from '../src/utils/polyline';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

const prisma = new PrismaClient();
const DAY = 86400_000;
const dateOnly = (ms: number) => new Date(new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10) + 'T00:00:00.000Z');
const seq = async (name: string, prefix: string, pad: number) => `${prefix}${String((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT nextval('${name}') AS n`))[0].n).padStart(pad, '0')}`;
const pan = (n: number) => `TRPDM${String(n).padStart(4, '0')}Z`;
const reg = (n: number) => `MH47TD${String(n).padStart(4, '0')}`;

const ROUTES = [
  { a: { city: 'Pune', state: 'Maharashtra', address: 'Chakan MIDC Phase II, Pune', lat: 18.7606, lng: 73.8636 }, b: { city: 'Mumbai', state: 'Maharashtra', address: 'Mahul Road, Chembur, Mumbai', lat: 19.0176, lng: 72.8996 }, km: 165 },
  { a: { city: 'Nashik', state: 'Maharashtra', address: 'D-22 Satpur MIDC, Nashik', lat: 20.0063, lng: 73.751 }, b: { city: 'Surat', state: 'Gujarat', address: 'Hazira Road, Surat', lat: 21.1137, lng: 72.638 }, km: 260 },
  { a: { city: 'Vadodara', state: 'Gujarat', address: 'Refinery Road, Koyali, Vadodara', lat: 22.379, lng: 73.122 }, b: { city: 'Ahmedabad', state: 'Gujarat', address: 'Changodar Industrial Estate, Ahmedabad', lat: 22.9265, lng: 72.4432 }, km: 120 },
];

async function role(name: RoleName) {
  return (await prisma.role.findUniqueOrThrow({ where: { name } })).id;
}

async function main() {
  if (await prisma.user.findUnique({ where: { phone: '9200000001' } })) return console.log('Transporter demo data already present. Nothing to do.');
  const companies = await prisma.company.findMany({ where: { isDemo: true, status: 'VERIFIED' }, include: { members: { take: 1 } } });
  if (companies.length === 0) throw new Error('Run npm run db:seed:demo first.');
  const [products, type] = await Promise.all([prisma.product.findMany({ where: { isActive: true, requiresSpecialApproval: false } }), prisma.tankerType.findFirstOrThrow({ where: { isActive: true } })]);
  const passwordHash = await hashPassword('Demo@12345');
  const [ownerRole, driverRole] = [await role('AGENCY_OWNER'), await role('DRIVER')];

  const makeTransporter = async (i: number, name: string, status: 'APPROVED' | 'PENDING_VERIFICATION' | 'SUSPENDED') => {
    const user = await prisma.user.create({ data: { fullName: `${name} Owner`, phone: `920000000${i}`, email: `portal.transporter${i}@tankerlink.example`, passwordHash, passwordChangedAt: new Date(), isPhoneVerified: true, isEmailVerified: true, accountStatus: 'ACTIVE', roles: { create: { roleId: ownerRole } } } });
    return prisma.agency.create({
      data: {
        companyName: `${name} (Demo)`, ownerId: user.id, panNumber: pan(i), gstNumber: buildGstin('27', pan(i)), businessType: 'FLEET_OWNER', address: `${i} Transport Nagar, Nigdi`, city: 'Pune', state: 'Maharashtra', pincode: '411044', verificationStatus: status, verifiedAt: status === 'APPROVED' ? new Date() : null, suspensionReason: status === 'SUSPENDED' ? 'Demo suspension' : null, termsAcceptedAt: new Date(), isDemo: true, rating: 4.4,
        serviceStates: ['Maharashtra', 'Gujarat'], operatingCities: ['Pune', 'Mumbai', 'Surat'], preferredRoutes: ['Pune-Mumbai'], declaredTankers: 8, capacityCategories: ['20'], productCategories: products.map((p) => p.code),
        members: { create: { userId: user.id, role: 'AGENCY_OWNER' } }, contacts: { create: { name: `${name} Owner`, phone: `920000000${i}`, isPrimary: true } },
      },
    });
  };
  const verified = await makeTransporter(1, 'Sahyadri Bulk Carriers', 'APPROVED');
  await makeTransporter(2, 'Konkan Tankers', 'PENDING_VERIFICATION');
  await makeTransporter(3, 'Deccan Haulage', 'SUSPENDED');

  // Top up to the requested demo volumes, adding to whatever db:seed:demo created.
  const peers = await prisma.agency.findMany({ where: { isDemo: true, verificationStatus: 'APPROVED', id: { not: verified.id } }, select: { id: true } });
  let t = 0;
  const addTanker = (transporterId: string, status: 'AVAILABLE' | 'BOOKED' = 'AVAILABLE') => prisma.tanker.create({
    data: { transporterId, registrationNumber: reg(++t), capacityKl: 20, tankerTypeId: type.id, compartments: 2, status, verificationStatus: 'APPROVED', isDemo: true, vehicleMake: 'Tata', vehicleModel: 'Signa 3518', manufacturingYear: 2022, gpsDeviceId: `DEMO-${t}`, availableLocation: 'Pune yard', insuranceExpiry: new Date(Date.now() + (t % 5 === 0 ? 20 : 300) * DAY), fitnessExpiry: new Date(Date.now() + 300 * DAY), products: { create: products.map((p) => ({ productId: p.id })) } },
  });
  const mine: Awaited<ReturnType<typeof addTanker>>[] = [];
  for (let i = 0; i < 30; i++) mine.push(await addTanker(verified.id, i < 18 ? 'BOOKED' : 'AVAILABLE'));
  for (let need = 30 - (await prisma.tanker.count({ where: { isDemo: true } })), i = 0; i < need; i++) await addTanker(peers[i % peers.length].id);

  let d = 0;
  const addDriver = async (agencyId: string) => {
    d++;
    const phone = `92000${String(10 + d).padStart(5, '0')}`;
    const user = await prisma.user.create({ data: { fullName: `Demo Driver ${d}`, phone, accountStatus: d === 1 ? 'ACTIVE' : 'PENDING_VERIFICATION', isPhoneVerified: d === 1, roles: { create: { roleId: driverRole } } } });
    const row = await prisma.driver.create({ data: { userId: user.id, agencyId, licenceNumber: `MH47D${String(d).padStart(9, '0')}`, licenceType: 'HGMV', licenceExpiry: new Date(Date.now() + 700 * DAY), hazardousTraining: 'VALID', hazardousTrainingExpiry: new Date(Date.now() + 400 * DAY), verificationStatus: 'APPROVED', isDemo: true, address: 'Bhosari, Pune', emergencyContactName: 'Family contact', emergencyContactPhone: '9822000000', history: { create: { transporterId: agencyId, reason: 'Demo data' } } } });
    await prisma.agencyMember.create({ data: { agencyId, userId: user.id, role: 'DRIVER' } });
    return row;
  };
  const drivers: Awaited<ReturnType<typeof addDriver>>[] = [];
  for (let i = 0; i < 24; i++) drivers.push(await addDriver(verified.id)); // first is 9200000011
  for (let need = 40 - (await prisma.driver.count({ where: { isDemo: true } })), i = 0; i < need; i++) await addDriver(peers[i % peers.length].id);

  let n = 0;
  const makeBooking = async (status: BookingStatus, offsetDays: number, createdAgo = 1) => {
    const r = ROUTES[n % ROUTES.length];
    const c = companies[n++ % companies.length];
    const load = Date.now() + offsetDays * DAY;
    const freight = 180 * r.km * (1 + (n % 4) * 0.05);
    const customerOffer = Math.round(freight * 0.95);
    return prisma.booking.create({
      data: {
        bookingCode: await seq('booking_code_seq', 'TLB', 7), companyId: c.id, createdById: c.members[0]?.userId, status, productId: products[n % products.length].id, distanceKm: r.km, durationMinutes: Math.round((r.km / 40) * 60), routePolyline: encodePolyline([r.a as LatLng, r.b as LatLng]), routeProvider: 'demo-approximation',
        ratePerKm: 180, suggestedFreight: Math.round(freight), customerOffer, loadingDate: dateOnly(load), loadingTime: '09:00', loadingContactName: 'Ravi Kale', loadingContactPhone: '9822001100', expectedDeliveryDate: dateOnly(load + DAY), deliveryContactName: 'Mehul Shah', deliveryContactPhone: '9825001100', isDemo: true, createdAt: new Date(Date.now() - createdAgo * DAY), confirmedAt: ['SEARCHING', 'OFFERS_RECEIVED', 'NEGOTIATION'].includes(status) ? null : new Date(Date.now() - createdAgo * DAY),
        locations: { create: [{ type: 'PICKUP', address: r.a.address, latitude: r.a.lat, longitude: r.a.lng, city: r.a.city, state: r.a.state }, { type: 'DELIVERY', address: r.b.address, latitude: r.b.lat, longitude: r.b.lng, city: r.b.city, state: r.b.state }] },
        requirement: { create: { tankerCapacityKl: 20, quantityKl: 20, numberOfTankers: 1 } },
      },
    });
  };
  const offer = (bookingId: string, amount: number | Prisma.Decimal, status: OfferStatus, transporterId = verified.id) => prisma.transporterOffer.create({
    data: { bookingId, transporterId, status, initialAmount: amount, currentAmount: amount, lastActionBy: status === 'COUNTERED' ? 'COMPANY' : 'TRANSPORTER', tankersAvailable: 1, tankerCapacityKl: 20, estimatedAvailabilityAt: new Date(Date.now() + 2 * DAY), expiresAt: new Date(Date.now() + DAY), isDemo: true, closedAt: ['PENDING', 'COUNTERED'].includes(status) ? null : new Date(), history: { create: { bookingId: bookingId, party: 'TRANSPORTER', action: 'OFFER_SUBMITTED', amount, isDemo: true } } },
  });

  // 25 open bookings. The verified transporter has bid on none, so all 25 show in its marketplace.
  const open = [];
  for (let i = 0; i < 25; i++) open.push(await makeBooking('SEARCHING', 3 + (i % 10)));

  // 30 offers on separate bookings, covering every state of the negotiation page.
  const STATES: OfferStatus[] = ['PENDING', 'COUNTERED', 'REJECTED', 'EXPIRED', 'WITHDRAWN', 'UNSUCCESSFUL'];
  for (let i = 0; i < 30; i++) {
    const s = STATES[i % STATES.length];
    const b = await makeBooking(['PENDING', 'COUNTERED'].includes(s) ? (s === 'COUNTERED' ? 'NEGOTIATION' : 'OFFERS_RECEIVED') : 'SEARCHING', 4 + (i % 8));
    await offer(b.id, b.customerOffer.times(1.08).toDecimalPlaces(0), s);
  }

  const award = async (status: BookingStatus, tripStatus: TripStatus, offsetDays: number, ix: number, finished = false) => {
    const b = await makeBooking(status, offsetDays, Math.max(1, -offsetDays + 2));
    const o = await offer(b.id, b.customerOffer, 'ACCEPTED');
    const a = await prisma.bookingAllocation.create({ data: { bookingId: b.id, offerId: o.id, transporterId: verified.id, tankersAllocated: 1, agreedFreight: b.customerOffer, status: finished ? 'COMPLETED' : tripStatus === 'SCHEDULED' ? 'CONFIRMED' : 'IN_PROGRESS', createdAt: b.createdAt } });
    const assigned = tripStatus !== 'SCHEDULED';
    const r = ROUTES[(n - 1) % ROUTES.length];
    const trip = await prisma.trip.create({ data: { tripCode: await seq('trip_code_seq', 'TRP', 7), allocationId: a.id, bookingId: b.id, transporterId: verified.id, tankerId: assigned ? mine[ix].id : null, driverId: assigned ? drivers[ix].id : null, status: tripStatus, plannedDistanceKm: r.km, isSimulated: true, completedAt: finished ? new Date(Date.now() + offsetDays * DAY + DAY) : null, deliveredAt: finished ? new Date(Date.now() + offsetDays * DAY + DAY) : null, createdAt: b.createdAt } });
    if (tripStatus === 'IN_TRANSIT') {
      const lat = (r.a.lat + r.b.lat) / 2;
      const lng = (r.a.lng + r.b.lng) / 2;
      await prisma.tripTracking.create({ data: { tripId: trip.id, latitude: lat, longitude: lng, speedKmph: 42, heading: 280, source: 'SIMULATED', recordedAt: new Date() } });
      await prisma.trip.update({ where: { id: trip.id }, data: { lastLatitude: lat, lastLongitude: lng, lastGpsAt: new Date(), etaAt: new Date(Date.now() + 3 * 3600_000) } });
    }
    await commissionForAllocation(a.id);
    if (finished) await prisma.settlement.update({ where: { allocationId: a.id }, data: ix % 2 ? { status: 'SETTLED', reference: `UTRDEMO${ix}`, settledAt: new Date(Date.now() + offsetDays * DAY + 2 * DAY) } : { status: 'PENDING' } });
    return trip;
  };
  for (let i = 0; i < 10; i++) await award('CONFIRMED', 'SCHEDULED', 3 + i, i);
  const ACTIVE: [BookingStatus, TripStatus][] = [['VEHICLE_ASSIGNED', 'VEHICLE_ASSIGNED'], ['DRIVER_ASSIGNED', 'DRIVER_ASSIGNED'], ['DRIVER_ASSIGNED', 'DRIVER_ACCEPTED'], ['LOADING', 'LOADING'], ['IN_TRANSIT', 'IN_TRANSIT'], ['IN_TRANSIT', 'IN_TRANSIT'], ['IN_TRANSIT', 'REACHED_DESTINATION'], ['IN_TRANSIT', 'UNLOADING_STARTED']];
  // Trip index 0 belongs to driver 9200000011, so that login opens straight onto a trip.
  for (let i = 0; i < ACTIVE.length; i++) await award(ACTIVE[i][0], ACTIVE[i][1], i === 0 ? 0 : 1, i);
  for (let i = 0; i < 15; i++) await award('COMPLETED', 'COMPLETED', -(3 + i * 5), 8 + (i % 10), true);

  // Point driver 1's first trip at a state where the login has an action to take.
  const first = await prisma.trip.findFirstOrThrow({ where: { driverId: drivers[0].id, status: 'VEHICLE_ASSIGNED' } });
  await prisma.trip.update({ where: { id: first.id }, data: { status: 'DRIVER_ASSIGNED' } });

  const owner = await prisma.agency.findUniqueOrThrow({ where: { id: verified.id }, select: { ownerId: true } });
  for (const [title, type2] of [['New booking available (demo)', 'NEW_BOOKING_AVAILABLE'], ['Counter-offer received (demo)', 'COUNTER_OFFER_RECEIVED'], ['Settlement processed (demo)', 'SETTLEMENT_PROCESSED']] as const) {
    await prisma.notification.create({ data: { userId: owner.ownerId, type: type2, title, message: 'Sample notification from demo data.', link: '/transporter/dashboard' } });
  }
  for (const [category, subject] of [['GPS_ISSUE', 'GPS not updating on one tanker (demo)'], ['SETTLEMENT_ISSUE', 'Query on a settlement (demo)']] as const) {
    await prisma.supportTicket.create({ data: { ticketNumber: await seq('ticket_code_seq', 'TKT', 6), transporterId: verified.id, raisedByType: 'TRANSPORTER', category, subject, description: 'Sample ticket created by demo data for the Transporter Portal.', createdById: owner.ownerId } });
  }
  const c = async (w: Prisma.TripWhereInput) => prisma.trip.count({ where: { transporterId: verified.id, ...w } });
  console.log(`Seeded. Verified transporter 9200000001: tankers 30, drivers 24, open bookings 25, offers 30+33, confirmed ${await c({ status: 'SCHEDULED' })}, active ${await c({ status: { notIn: ['SCHEDULED', 'COMPLETED'] } })}, completed ${await c({ status: 'COMPLETED' })}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
