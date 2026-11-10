/**
 * ============================================================================
 *  DEMO DATA (development / demonstration environments only)
 * ============================================================================
 *   npm run db:seed:demo
 *
 * Creates clearly-labelled demo data so every Company Portal screen can be demonstrated:
 *   5 demo companies, 10 demo transporters, 20 tankers, 20 drivers, 25 bookings across all statuses,
 *   transporter offers & negotiation history, 11 completed/delivered trips, 5 active trips,
 *   invoices, payment history, simulated tracking, delivery proofs and notifications.
 *
 * Every company/transporter name ends in "(Demo)", all rows carry isDemo / SIMULATED flags and the
 * UI shows DEMO badges. Refuses to run when NODE_ENV=production. Runs once (skips if already seeded).
 */
import 'dotenv/config';
import { Prisma, PrismaClient, type Agency, type BookingStatus, type Driver, type Tanker, type TripStatus, type User } from '@prisma/client';
import { storage } from '../src/lib/storage';
import { demoDeliveryProofPdf } from '../src/modules/documents/document.service';
import { estimateFreight } from '../src/modules/pricing/pricing.service';
import { hashPassword } from '../src/modules/auth/password.service';
import { invoiceAmounts } from '../src/modules/payments/payment.calc';
import { buildGstin, stateCodeFor } from '../src/utils/gst';
import { decodePolyline, encodePolyline, haversineKm, pointAlong, type LatLng } from '../src/utils/polyline';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

const prisma = new PrismaClient();
export const DEMO_PASSWORD = 'Demo@12345';
const DAY = 86400_000;
const now = Date.now();

// ---------------------------------------------------------------------------
// Places (real industrial locations)
// ---------------------------------------------------------------------------

type Place = { key: string; name: string; address: string; city: string; state: string; pincode: string; lat: number; lng: number };
const P: Record<string, Place> = Object.fromEntries(
  (
    [
      ['pune', 'Chakan MIDC Phase II', 'Plot 14, Chakan MIDC Phase II, Mahalunge, Pune', 'Pune', 'Maharashtra', '410501', 18.7606, 73.8636],
      ['mumbai', 'Mahul Oil Terminal', 'Mahul Road, Chembur, Mumbai', 'Mumbai', 'Maharashtra', '400074', 19.0176, 72.8996],
      ['nashik', 'Satpur MIDC', 'D-22, Satpur MIDC, Nashik', 'Nashik', 'Maharashtra', '422007', 20.0063, 73.751],
      ['nagpur', 'Butibori MIDC', 'Plot B-41, Butibori MIDC, Nagpur', 'Nagpur', 'Maharashtra', '441122', 20.931, 79.004],
      ['vadodara', 'Koyali Refinery Road', 'Refinery Road, Koyali, Vadodara', 'Vadodara', 'Gujarat', '391740', 22.379, 73.122],
      ['ahmedabad', 'Changodar Industrial Estate', 'Survey 211, Changodar Industrial Estate, Ahmedabad', 'Ahmedabad', 'Gujarat', '382213', 22.9265, 72.4432],
      ['surat', 'Hazira Industrial Area', 'Hazira Road, Hazira, Surat', 'Surat', 'Gujarat', '394270', 21.1137, 72.638],
      ['jamnagar', 'Motikhavdi Terminal', 'Motikhavdi, Jamnagar', 'Jamnagar', 'Gujarat', '361142', 22.356, 69.86],
      ['indore', 'Pithampur Sector 3', 'Sector 3, Pithampur Industrial Area, Dhar', 'Pithampur', 'Madhya Pradesh', '454775', 22.6086, 75.6815],
      ['hyderabad', 'Patancheru IDA', 'Phase 1, IDA Patancheru, Sangareddy', 'Hyderabad', 'Telangana', '502319', 17.53, 78.265],
      ['vizag', 'Visakh Refinery Gate', 'Malkapuram, Visakhapatnam', 'Visakhapatnam', 'Andhra Pradesh', '530011', 17.6868, 83.2185],
      ['chennai', 'Manali Industrial Area', 'Manali Express Road, Manali, Chennai', 'Chennai', 'Tamil Nadu', '600068', 13.1667, 80.2667],
      ['bengaluru', 'Peenya Industrial Area', '4th Phase, Peenya Industrial Area, Bengaluru', 'Bengaluru', 'Karnataka', '560058', 13.0285, 77.5197],
      ['panipat', 'Panipat Refinery Road', 'Baholi, Panipat', 'Panipat', 'Haryana', '132140', 29.474, 76.893],
    ] as const
  ).map(([key, name, address, city, state, pincode, lat, lng]) => [key, { key, name, address, city, state, pincode, lat, lng }]),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const code = async (seq: string, prefix: string, pad: number) => {
  const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT nextval('${seq}') AS n`);
  return `${prefix}${String(r[0].n).padStart(pad, '0')}`;
};
const r10 = (v: number) => Math.round(v / 10) * 10;
const at = (ms: number) => new Date(ms);
const dateOnly = (ms: number) => new Date(new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10) + 'T00:00:00.000Z');
let seq = 0;
const rnd = () => {
  // Deterministic pseudo-random so re-seeding a fresh DB gives the same demo.
  seq = (seq * 9301 + 49297) % 233280;
  return seq / 233280;
};

const routeCache = new Map<string, { km: number; mins: number; polyline: string; provider: string }>();
async function road(a: Place, b: Place) {
  const key = `${a.key}>${b.key}`;
  if (routeCache.has(key)) return routeCache.get(key)!;
  const osrm = process.env.OSRM_URL ?? 'https://router.project-osrm.org';
  try {
    const res = await fetch(`${osrm}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=polyline`, {
      headers: { 'User-Agent': process.env.MAPS_USER_AGENT ?? 'TankerLink/1.0 (development)' },
      signal: AbortSignal.timeout(12_000),
    });
    const data = (await res.json()) as { code: string; routes: { distance: number; duration: number; geometry: string }[] };
    if (data.code === 'Ok' && data.routes[0]) {
      const r = { km: Math.round(data.routes[0].distance / 10) / 100, mins: Math.round((data.routes[0].duration / 60) * 1.3), polyline: data.routes[0].geometry, provider: 'osm-osrm' };
      routeCache.set(key, r);
      await new Promise((ok) => setTimeout(ok, 1100)); // respect the public OSRM usage policy
      return r;
    }
  } catch {
    /* fall through */
  }
  // Offline fallback for demo seeding only - labelled so it is never mistaken for routed distance.
  const mid = { lat: (a.lat + b.lat) / 2 + 0.15, lng: (a.lng + b.lng) / 2 };
  const km = Math.round((haversineKm(a, mid) + haversineKm(mid, b)) * 1.18 * 100) / 100;
  const r = { km, mins: Math.round((km / 45) * 60), polyline: encodePolyline([a, mid, b]), provider: 'demo-approximation' };
  routeCache.set(key, r);
  return r;
}

// ---------------------------------------------------------------------------
// Master entities
// ---------------------------------------------------------------------------

const COMPANIES = [
  { name: 'Sahyadri Lubricants Pvt Ltd (Demo)', person: 'Anil Deshmukh', city: 'pune', type: 'MANUFACTURER', industry: 'Lubricants', pan: 'AABCS1234D' },
  { name: 'Sabarmati Petro Traders LLP (Demo)', person: 'Kiran Patel', city: 'ahmedabad', type: 'TRADER', industry: 'Fuel trading', pan: 'AAQFS5678K' },
  { name: 'Deccan Industrial Fuels Pvt Ltd (Demo)', person: 'Srinivas Reddy', city: 'hyderabad', type: 'DISTRIBUTOR', industry: 'Industrial fuels', pan: 'AADCD2468L' },
  { name: 'Kaveri Base Oils Ltd (Demo)', person: 'Lakshmi Narayanan', city: 'chennai', type: 'MANUFACTURER', industry: 'Base oil blending', pan: 'AAECK1357M' },
  { name: 'Malwa Process Industries Pvt Ltd (Demo)', person: 'Rakesh Jain', city: 'indore', type: 'INDUSTRIAL_CONSUMER', industry: 'Process heating', pan: 'AAFCM9753N' },
] as const;

const TRANSPORTERS = [
  { name: 'Western Roadlines (Demo)', owner: 'Mahesh Shinde', city: 'pune', rating: 4.7, trips: 612, tankers: [['PESO_PETROLEUM', 24, 1, ['PETROL', 'DIESEL']], ['SS_TANKER', 20, 2, ['LUBRICATING_OIL', 'BASE_OIL', 'INDUSTRIAL_OIL']]] },
  { name: 'Konkan Tank Carriers (Demo)', owner: 'Sandeep Naik', city: 'mumbai', rating: 4.5, trips: 388, tankers: [['SS_TANKER', 24, 3, ['LUBRICATING_OIL', 'BASE_OIL']], ['MS_TANKER', 30, 1, ['DIESEL', 'INDUSTRIAL_OIL', 'FURNACE_OIL']]] },
  { name: 'Saurashtra Petro Movers (Demo)', owner: 'Jignesh Bhatt', city: 'jamnagar', rating: 4.8, trips: 540, tankers: [['PESO_PETROLEUM', 30, 2, ['PETROL', 'DIESEL']], ['INSULATED_HEATED', 20, 1, ['FURNACE_OIL', 'INDUSTRIAL_OIL']]] },
  { name: 'Vindhya Tankers (Demo)', owner: 'Ajay Tiwari', city: 'indore', rating: 4.2, trips: 205, tankers: [['SS_TANKER', 16, 2, ['LUBRICATING_OIL', 'BASE_OIL', 'INDUSTRIAL_OIL']], ['ALUMINIUM', 24, 1, ['DIESEL', 'LUBRICATING_OIL']]] },
  { name: 'Godavari Logistics (Demo)', owner: 'Venkat Rao', city: 'hyderabad', rating: 4.4, trips: 317, tankers: [['MS_TANKER', 20, 1, ['DIESEL', 'INDUSTRIAL_OIL']], ['SS_TANKER', 30, 3, ['LUBRICATING_OIL', 'BASE_OIL']]] },
  { name: 'Nilgiri Fuel Carriers (Demo)', owner: 'Murugan Pillai', city: 'chennai', rating: 4.1, trips: 156, tankers: [['SS_TANKER', 12, 1, ['LUBRICATING_OIL', 'BASE_OIL']], ['PESO_PETROLEUM', 20, 2, ['PETROL', 'DIESEL']]] },
  { name: 'Ganga Transport Co (Demo)', owner: 'Ravi Shankar Mishra', city: 'panipat', rating: 3.9, trips: 98, tankers: [['INSULATED_HEATED', 24, 1, ['FURNACE_OIL']], ['MS_TANKER', 16, 1, ['DIESEL', 'INDUSTRIAL_OIL', 'FURNACE_OIL']]] },
  { name: 'Malwa Bulk Movers (Demo)', owner: 'Harish Choudhary', city: 'indore', rating: 4.3, trips: 244, tankers: [['ALUMINIUM', 20, 2, ['DIESEL', 'LUBRICATING_OIL', 'BASE_OIL']], ['PESO_PETROLEUM', 12, 1, ['PETROL', 'DIESEL']]] },
  { name: 'Kaveri Tank Lines (Demo)', owner: 'Prakash Gowda', city: 'bengaluru', rating: 4.6, trips: 431, tankers: [['SS_TANKER', 20, 2, ['LUBRICATING_OIL', 'BASE_OIL', 'INDUSTRIAL_OIL']], ['MS_TANKER', 10, 1, ['DIESEL', 'INDUSTRIAL_OIL']]] },
  { name: 'Aravali Freight Carriers (Demo)', owner: 'Vikram Singh Rathore', city: 'ahmedabad', rating: 4.0, trips: 172, tankers: [['PESO_PETROLEUM', 20, 2, ['PETROL', 'DIESEL']], ['SS_TANKER', 24, 2, ['LUBRICATING_OIL', 'BASE_OIL', 'INDUSTRIAL_OIL']]] },
] as const;

const DRIVER_NAMES = [
  'Ramesh Yadav', 'Suresh Pawar', 'Dinesh Kumar', 'Baldev Singh', 'Mohan Lal', 'Iqbal Shaikh', 'Gopal Reddy', 'Arjun Patil', 'Satish Gaikwad', 'Manoj Verma',
  'Raju Naidu', 'Selvam Kumar', 'Harpreet Singh', 'Rajendra Meena', 'Sunil Jadhav', 'Anwar Khan', 'Kumaraswamy', 'Bharat Solanki', 'Naveen Chauhan', 'Prem Thakur',
];

// [company, from, to, product, capacityKl, tankers, status, daysAgo]
const BOOKINGS: [number, string, string, string, number, number, BookingStatus, number][] = [
  [0, 'pune', 'mumbai', 'LUBRICATING_OIL', 20, 1, 'COMPLETED', 150],
  [0, 'mumbai', 'pune', 'BASE_OIL', 20, 1, 'COMPLETED', 135],
  [0, 'pune', 'nashik', 'LUBRICATING_OIL', 16, 1, 'COMPLETED', 118],
  [0, 'pune', 'ahmedabad', 'LUBRICATING_OIL', 20, 1, 'COMPLETED', 97],
  [0, 'vadodara', 'pune', 'BASE_OIL', 24, 1, 'COMPLETED', 76],
  [0, 'pune', 'nagpur', 'LUBRICATING_OIL', 20, 2, 'COMPLETED', 52],
  [0, 'pune', 'mumbai', 'INDUSTRIAL_OIL', 24, 1, 'CANCELLED', 44],
  [0, 'pune', 'hyderabad', 'LUBRICATING_OIL', 20, 1, 'DELIVERED', 6],
  [0, 'mumbai', 'pune', 'BASE_OIL', 20, 1, 'IN_TRANSIT', 2],
  [0, 'pune', 'indore', 'LUBRICATING_OIL', 16, 1, 'LOADING', 1.5],
  [0, 'pune', 'surat', 'LUBRICATING_OIL', 20, 1, 'CONFIRMED', 1],
  [0, 'pune', 'bengaluru', 'LUBRICATING_OIL', 20, 1, 'OFFERS_RECEIVED', 0.5],
  [0, 'nashik', 'pune', 'BASE_OIL', 16, 1, 'NEGOTIATION', 1],
  [0, 'pune', 'mumbai', 'LUBRICATING_OIL', 12, 1, 'SEARCHING', 0.2],
  [0, 'pune', 'vadodara', 'LUBRICATING_OIL', 24, 1, 'OFFERS_RECEIVED', 0.3],
  [1, 'ahmedabad', 'jamnagar', 'DIESEL', 20, 1, 'COMPLETED', 88],
  [1, 'jamnagar', 'surat', 'PETROL', 20, 1, 'COMPLETED', 39],
  [1, 'ahmedabad', 'indore', 'DIESEL', 24, 1, 'DRIVER_ASSIGNED', 2],
  [1, 'surat', 'ahmedabad', 'DIESEL', 20, 1, 'SEARCHING', 0.1],
  [2, 'hyderabad', 'vizag', 'DIESEL', 20, 1, 'COMPLETED', 68],
  [2, 'hyderabad', 'chennai', 'DIESEL', 16, 1, 'COMPLETED', 29],
  [2, 'hyderabad', 'bengaluru', 'DIESEL', 20, 1, 'VEHICLE_ASSIGNED', 3],
  [3, 'chennai', 'bengaluru', 'BASE_OIL', 20, 1, 'NEGOTIATION', 1],
  [4, 'indore', 'nagpur', 'FURNACE_OIL', 20, 1, 'CANCELLED', 24],
  [4, 'panipat', 'indore', 'FURNACE_OIL', 20, 1, 'OFFERS_RECEIVED', 0.4],
];

const FLOW: BookingStatus[] = ['SEARCHING', 'OFFERS_RECEIVED', 'NEGOTIATION', 'CONFIRMED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'LOADING', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];
const CONFIRMED_PLUS: BookingStatus[] = FLOW.slice(3);

async function main() {
  if (await prisma.company.findFirst({ where: { isDemo: true } })) {
    console.log('Demo data already present - nothing to do. (Reset the database to re-seed.)');
    return;
  }
  const roles = new Map((await prisma.role.findMany()).map((r) => [r.name, r.id]));
  if (!roles.get('COMPANY_ADMIN')) throw new Error('Run "npm run db:seed" first (roles and reference data).');
  const products = new Map((await prisma.product.findMany()).map((p) => [p.code, p]));
  const types = new Map((await prisma.tankerType.findMany()).map((t) => [t.code, t]));
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // ---- Companies -------------------------------------------------------------------------
  const companies = [];
  for (const [i, c] of COMPANIES.entries()) {
    const place = P[c.city];
    const phone = `91000000${String(i + 1).padStart(2, '0')}`;
    const email = `demo.company${i + 1}@tankerlink.example`;
    const user = await prisma.user.create({
      data: { fullName: c.person, phone, email, passwordHash, passwordChangedAt: new Date(), isPhoneVerified: true, isEmailVerified: true, accountStatus: 'ACTIVE', roles: { create: { roleId: roles.get('COMPANY_ADMIN')! } } },
    });
    const company = await prisma.company.create({
      data: {
        companyCode: await code('company_code_seq', 'CMP', 6),
        name: c.name,
        gstNumber: buildGstin(stateCodeFor(place.state)!, c.pan),
        panNumber: c.pan,
        businessType: c.type,
        industry: c.industry,
        website: `https://demo-company${i + 1}.example`,
        contactPersonName: c.person,
        contactPhone: phone,
        contactEmail: email,
        status: i === 4 ? 'PENDING_VERIFICATION' : 'VERIFIED',
        verifiedAt: i === 4 ? null : at(now - 200 * DAY),
        termsAcceptedAt: at(now - 210 * DAY),
        isDemo: true,
        createdAt: at(now - 210 * DAY),
        members: { create: { userId: user.id, role: 'COMPANY_ADMIN' } },
        addresses: { create: { type: 'REGISTERED', address: place.address, city: place.city, state: place.state, pincode: place.pincode } },
        contacts: { create: [{ name: c.person, phone, email, isPrimary: true, designation: 'Director' }, { name: 'Logistics Desk', phone: `92000000${String(i + 1).padStart(2, '0')}`, designation: 'Dispatch' }] },
      },
    });
    companies.push({ company, user, phone, email });
  }

  // Saved locations for the main demo company.
  const c0 = companies[0].company;
  const saved = await Promise.all(
    [
      ['Chakan Blending Plant', 'FACTORY', 'pune', true, false],
      ['Mahul Base Oil Terminal', 'OIL_DEPOT', 'mumbai', false, false],
      ['Satpur Warehouse', 'WAREHOUSE', 'nashik', false, true],
      ['Peenya Distributor', 'DELIVERY_POINT', 'bengaluru', false, false],
    ].map(([name, type, key, dp, dd]) => {
      const pl = P[key as string];
      return prisma.savedLocation.create({
        data: { companyId: c0.id, name: name as string, type: type as never, address: pl.address, latitude: pl.lat, longitude: pl.lng, city: pl.city, state: pl.state, pincode: pl.pincode, contactPerson: 'Site In-charge', contactPhone: '9822000011', isDefaultPickup: dp as boolean, isDefaultDelivery: dd as boolean },
      });
    }),
  );
  const savedByCity = new Map(saved.map((s) => [s.city, s.id]));

  // ---- Transporters, tankers, drivers ---------------------------------------------------------
  const transporters: { agency: Agency; tankers: Tanker[]; drivers: (Driver & { user: User })[]; def: (typeof TRANSPORTERS)[number] }[] = [];
  let driverIdx = 0;
  for (const [i, t] of TRANSPORTERS.entries()) {
    const place = P[t.city];
    const pan = `AAH${'CDEFGHJKLM'[i]}T${String(4100 + i * 37).padStart(4, '0')}${'PQRSTUVWXY'[i]}`;
    const owner = await prisma.user.create({
      data: { fullName: t.owner, phone: `80000000${String(i + 1).padStart(2, '0')}`, email: `demo.transporter${i + 1}@tankerlink.example`, isPhoneVerified: true, accountStatus: 'ACTIVE', roles: { create: { roleId: roles.get('AGENCY_OWNER')! } } },
    });
    const agency = await prisma.agency.create({
      data: {
        companyName: t.name,
        ownerId: owner.id,
        panNumber: pan,
        gstNumber: buildGstin(stateCodeFor(place.state)!, pan),
        address: place.address,
        city: place.city,
        state: place.state,
        pincode: place.pincode,
        verificationStatus: 'APPROVED',
        verifiedAt: at(now - 300 * DAY),
        termsAcceptedAt: at(now - 320 * DAY),
        rating: t.rating,
        completedTrips: t.trips,
        serviceStates: [...new Set([place.state, 'Maharashtra', 'Gujarat'])],
        isDemo: true,
        members: { create: { userId: owner.id, role: 'AGENCY_OWNER' } },
      },
    });
    const tankers = [];
    for (const [j, [typeCode, cap, compartments, prods]] of t.tankers.entries()) {
      const st = stateCodeFor(place.state)!;
      const rto = { '27': 'MH', '24': 'GJ', '23': 'MP', '36': 'TS', '33': 'TN', '06': 'HR', '29': 'KA' }[st] ?? 'MH';
      tankers.push(
        await prisma.tanker.create({
          data: {
            transporterId: agency.id,
            registrationNumber: `${rto}${String(10 + i).padStart(2, '0')}${'ABCDEFGHJK'[i]}${'TU'[j]}${String(1000 + i * 113 + j * 7)}`,
            capacityKl: cap,
            compartments,
            tankerTypeId: types.get(typeCode)!.id,
            gpsDeviceId: `GPS-DEMO-${i + 1}${j + 1}`,
            isDemo: true,
            products: { create: prods.map((p) => ({ productId: products.get(p)!.id })) },
          },
        }),
      );
    }
    const drivers = [];
    for (let j = 0; j < 2; j++) {
      const name = DRIVER_NAMES[driverIdx];
      const user = await prisma.user.create({
        data: { fullName: name, phone: `70000000${String(driverIdx + 1).padStart(2, '0')}`, isPhoneVerified: true, accountStatus: 'ACTIVE', roles: { create: { roleId: roles.get('DRIVER')! } } },
      });
      drivers.push(
        await prisma.driver.create({
          data: { userId: user.id, agencyId: agency.id, licenceNumber: `MH14${2012 + (driverIdx % 9)}${String(5000000 + driverIdx * 7919).padStart(7, '0')}`, licenceType: 'HGMV', licenceExpiry: at(now + 900 * DAY), verificationStatus: 'APPROVED', isDemo: true },
          include: { user: true },
        }),
      );
      await prisma.agencyMember.create({ data: { agencyId: agency.id, userId: user.id, role: 'DRIVER' } });
      driverIdx++;
    }
    transporters.push({ agency, tankers, drivers, def: t });
  }

  const eligible = (productCode: string, cap: number) =>
    transporters.filter((t) => t.def.tankers.some(([, c, , prods]) => c >= cap && (prods as readonly string[]).includes(productCode)));

  const settings = { platformFeePercent: 2, gstPercent: 5, advancePercent: 30 };

  // ---- Bookings -------------------------------------------------------------------------------
  let rotate = 0;
  const busyTankers = new Set<string>();
  const busyDrivers = new Set<string>();
  const notifications: Prisma.NotificationCreateManyInput[] = [];
  const deliveredBookings: string[] = [];

  for (const [idx, [ci, from, to, productCode, cap, nTankers, status, daysAgo]] of BOOKINGS.entries()) {
    const comp = companies[ci];
    const a = P[from];
    const b = P[to];
    const route = await road(a, b);
    const product = products.get(productCode)!;
    const est = await estimateFreight({ distanceKm: route.km, capacityKl: cap, productId: product.id, originState: a.state, destState: b.state, numberOfTankers: nTankers });
    const suggested = est.suggestedFreight.toNumber();
    const customerOffer = r10(suggested * (0.9 + rnd() * 0.08));
    const createdMs = now - daysAgo * DAY;
    const isOpen = ['SEARCHING', 'OFFERS_RECEIVED', 'NEGOTIATION'].includes(status);
    const loadingMs = isOpen ? now + (2 + (idx % 3)) * DAY : createdMs + 2 * DAY;
    const transitDays = Math.max(1, Math.ceil(route.mins / 600));
    const deliveryMs = loadingMs + transitDays * DAY;
    const reach = FLOW.indexOf(status === 'CANCELLED' ? (idx === 6 ? 'SEARCHING' : 'OFFERS_RECEIVED') : status);
    const pool = eligible(productCode, cap);
    if (pool.length === 0) throw new Error(`No demo transporter can carry ${productCode} at ${cap} KL`);
    const winner = pool[rotate++ % pool.length];
    const accepted = CONFIRMED_PLUS.includes(status) ? r10(customerOffer * (1 + rnd() * 0.07)) : null;
    const confirmedMs = createdMs + 0.4 * DAY;

    const booking = await prisma.booking.create({
      data: {
        bookingCode: await code('booking_code_seq', 'TLB', 7),
        companyId: comp.company.id,
        createdById: comp.user.id,
        status,
        productId: product.id,
        distanceKm: route.km,
        durationMinutes: route.mins,
        routePolyline: route.polyline,
        routeSummary: `${a.city} to ${b.city}`,
        routeProvider: route.provider,
        pricingRuleId: est.ruleId,
        ratePerKm: est.ratePerKm,
        suggestedFreight: est.suggestedFreight,
        customerOffer,
        acceptedFreight: accepted,
        loadingDate: dateOnly(loadingMs),
        loadingTime: ['08:00', '09:30', '07:00', '10:00'][idx % 4],
        loadingContactName: 'Plant Dispatch Officer',
        loadingContactPhone: '9822000011',
        loadingInstructions: idx % 2 ? 'Report at Gate 2 with PESO licence and valid fitness certificate.' : 'Safety induction mandatory. Spark arrestor required.',
        expectedDeliveryDate: dateOnly(deliveryMs),
        deliveryContactName: 'Stores In-charge',
        deliveryContactPhone: '9890011223',
        deliveryInstructions: 'Unloading 9 AM - 6 PM. Share seal numbers before arrival.',
        confirmedAt: accepted ? at(confirmedMs) : null,
        cancelledAt: status === 'CANCELLED' ? at(createdMs + 0.6 * DAY) : null,
        cancellationReason: status === 'CANCELLED' ? (idx === 6 ? 'Production plan changed' : 'Plant shutdown - load postponed') : null,
        isDemo: true,
        createdAt: at(createdMs),
        locations: {
          create: [
            { type: 'PICKUP', address: `${a.name}, ${a.address}`, latitude: a.lat, longitude: a.lng, city: a.city, state: a.state, pincode: a.pincode, savedLocationId: ci === 0 ? savedByCity.get(a.city) : undefined },
            { type: 'DELIVERY', address: `${b.name}, ${b.address}`, latitude: b.lat, longitude: b.lng, city: b.city, state: b.state, pincode: b.pincode, savedLocationId: ci === 0 ? savedByCity.get(b.city) : undefined },
          ],
        },
        requirement: {
          create: { tankerCapacityKl: cap, quantityKl: cap * nTankers - (idx % 3 === 0 ? 1 : 0), numberOfTankers: nTankers, compartmentRequirement: 'ANY', productCompatibility: productCode === 'BASE_OIL' ? 'CLEANED_CERTIFIED' : 'ANY_COMPATIBLE', specialRequirements: idx % 4 === 0 ? 'Tank cleaning certificate required' : null },
        },
      },
    });

    // Status history up to the reached state.
    const history: Prisma.BookingStatusHistoryCreateManyInput[] = [];
    const steps = FLOW.slice(0, reach + 1);
    steps.forEach((s, k) => {
      if (k > 0 && s === 'NEGOTIATION' && status !== 'NEGOTIATION' && !CONFIRMED_PLUS.includes(status)) return;
      history.push({ bookingId: booking.id, fromStatus: k ? steps[k - 1] : null, toStatus: s, actorType: k === 0 ? 'COMPANY' : s === 'CONFIRMED' || s === 'NEGOTIATION' ? 'COMPANY' : 'SYSTEM', actorUserId: k === 0 ? comp.user.id : null, note: k === 0 ? 'Booking created' : undefined, createdAt: at(Math.min(now - 60_000, createdMs + k * (CONFIRMED_PLUS.includes(status) ? 0.25 : 0.05) * DAY)) });
    });
    if (status === 'CANCELLED') history.push({ bookingId: booking.id, fromStatus: steps[steps.length - 1], toStatus: 'CANCELLED', actorType: 'COMPANY', actorUserId: comp.user.id, note: booking.cancellationReason ?? undefined, createdAt: at(createdMs + 0.6 * DAY) });
    await prisma.bookingStatusHistory.createMany({ data: history });

    const offerExp = at(now + 20 * 3600_000);
    const mkOffer = async (t: (typeof transporters)[number], o: { status: Prisma.TransporterOfferCreateInput['status']; initial: number; current: number; lastBy: 'COMPANY' | 'TRANSPORTER'; round?: number; createdMs: number; closed?: boolean; hist: [ 'COMPANY' | 'TRANSPORTER' | 'SYSTEM', Prisma.OfferNegotiationHistoryCreateManyInput['action'], number | null, string | null, number][] }) => {
      const cap0 = t.def.tankers.find(([, c, , prods]) => c >= cap && (prods as readonly string[]).includes(productCode))![1];
      const offer = await prisma.transporterOffer.create({
        data: {
          bookingId: booking.id,
          transporterId: t.agency.id,
          status: o.status,
          initialAmount: o.initial,
          currentAmount: o.current,
          lastActionBy: o.lastBy,
          round: o.round ?? 1,
          tankersAvailable: nTankers,
          tankerCapacityKl: cap0,
          estimatedAvailabilityAt: at(loadingMs - 3 * 3600_000),
          remarks: o.initial === customerOffer ? 'Demo offer: accepts your price.' : 'Demo offer: GPS-fitted tanker, experienced driver.',
          expiresAt: o.closed ? at(o.createdMs + DAY) : offerExp,
          isDemo: true,
          createdAt: at(o.createdMs),
          closedAt: o.closed ? at(o.createdMs + 0.3 * DAY) : null,
        },
      });
      await prisma.offerNegotiationHistory.createMany({
        data: o.hist.map(([party, action, amount, message, ms]) => ({ offerId: offer.id, bookingId: booking.id, party, action, amount, message, isDemo: true, actorUserId: party === 'COMPANY' ? comp.user.id : null, createdAt: at(ms) })),
      });
      return offer;
    };

    if (status === 'OFFERS_RECEIVED') {
      const n = idx === 11 ? 3 : 2;
      for (let k = 0; k < n; k++) {
        const t = pool[(rotate + k) % pool.length];
        const amt = k === 0 ? customerOffer : r10(customerOffer * (1.04 + k * 0.05));
        const ms = createdMs + (k + 1) * 0.04 * DAY;
        await mkOffer(t, { status: 'PENDING', initial: amt, current: amt, lastBy: 'TRANSPORTER', createdMs: ms, hist: [['TRANSPORTER', amt === customerOffer ? 'CUSTOMER_PRICE_ACCEPTED' : 'OFFER_SUBMITTED', amt, null, ms]] });
        notifications.push({ userId: comp.user.id, companyId: comp.company.id, type: 'OFFER_RECEIVED', title: `New offer on ${booking.bookingCode} (demo)`, message: `${t.def.name} offered Rs ${amt.toLocaleString('en-IN')}.`, bookingId: booking.id, link: `/company/bookings/${booking.id}/offers`, createdAt: at(ms) });
      }
    } else if (status === 'NEGOTIATION') {
      // Thread 1: transporter 52k-style quote, company counters, transporter accepts the counter (company to confirm).
      const t1 = pool[rotate % pool.length];
      const t2 = pool[(rotate + 1) % pool.length];
      const quote = r10(customerOffer * 1.08);
      const counter = r10((customerOffer + quote) / 2);
      const m0 = createdMs + 0.1 * DAY;
      await mkOffer(t1, {
        status: 'PENDING', initial: quote, current: counter, lastBy: 'TRANSPORTER', round: 2, createdMs: m0,
        hist: [['TRANSPORTER', 'OFFER_SUBMITTED', quote, null, m0], ['COMPANY', 'COUNTER_OFFER', counter, 'Can you do this price? Regular lane for us.', m0 + 0.2 * DAY], ['TRANSPORTER', 'CUSTOMER_PRICE_ACCEPTED', counter, 'Demo: we accept your counter-offer.', m0 + 0.35 * DAY]],
      });
      const quote2 = r10(customerOffer * 1.12);
      const counter2 = r10(customerOffer * 1.02);
      await mkOffer(t2, {
        status: 'COUNTERED', initial: quote2, current: counter2, lastBy: 'COMPANY', round: 2, createdMs: m0 + 0.05 * DAY,
        hist: [['TRANSPORTER', 'OFFER_SUBMITTED', quote2, null, m0 + 0.05 * DAY], ['COMPANY', 'COUNTER_OFFER', counter2, null, m0 + 0.25 * DAY]],
      });
      notifications.push({ userId: comp.user.id, companyId: comp.company.id, type: 'COUNTER_OFFER_ACCEPTED', title: 'Counter-offer accepted (demo)', message: `${t1.def.name} accepted your price of Rs ${counter.toLocaleString('en-IN')} for ${booking.bookingCode}. Confirm the booking to lock it in.`, bookingId: booking.id, link: `/company/bookings/${booking.id}/offers`, createdAt: at(m0 + 0.35 * DAY) });
    } else if (status === 'CANCELLED' && reach >= 1) {
      const t = pool[rotate % pool.length];
      const ms = createdMs + 0.1 * DAY;
      await mkOffer(t, { status: 'UNSUCCESSFUL', initial: r10(customerOffer * 1.05), current: r10(customerOffer * 1.05), lastBy: 'TRANSPORTER', createdMs: ms, closed: true, hist: [['TRANSPORTER', 'OFFER_SUBMITTED', r10(customerOffer * 1.05), null, ms], ['SYSTEM', 'CLOSED', null, 'Booking cancelled by company', createdMs + 0.6 * DAY]] });
    }

    if (!accepted) continue;

    // Confirmed+ bookings: accepted offer (+ one unsuccessful competitor on some), allocation, trip, invoice, payments.
    const m0 = createdMs + 0.1 * DAY;
    const offer = await mkOffer(winner, {
      status: 'ACCEPTED', initial: accepted === customerOffer ? customerOffer : r10(accepted * 1.03), current: accepted, lastBy: 'COMPANY', round: accepted === customerOffer ? 1 : 2, createdMs: m0, closed: true,
      hist: accepted === customerOffer
        ? [['TRANSPORTER', 'CUSTOMER_PRICE_ACCEPTED', customerOffer, null, m0], ['COMPANY', 'ACCEPTED', accepted, null, confirmedMs]]
        : [['TRANSPORTER', 'OFFER_SUBMITTED', r10(accepted * 1.03), null, m0], ['COMPANY', 'COUNTER_OFFER', accepted, null, m0 + 0.1 * DAY], ['TRANSPORTER', 'CUSTOMER_PRICE_ACCEPTED', accepted, null, m0 + 0.2 * DAY], ['COMPANY', 'ACCEPTED', accepted, null, confirmedMs]],
    });
    if (idx % 3 === 0) {
      const loser = pool.find((t) => t.agency.id !== winner.agency.id);
      if (loser) {
        const amt = r10(accepted * 1.09);
        await mkOffer(loser, { status: 'UNSUCCESSFUL', initial: amt, current: amt, lastBy: 'TRANSPORTER', createdMs: m0 + 0.05 * DAY, closed: true, hist: [['TRANSPORTER', 'OFFER_SUBMITTED', amt, null, m0 + 0.05 * DAY], ['SYSTEM', 'CLOSED', null, 'Another transporter was selected', confirmedMs]] });
      }
    }
    const done = status === 'COMPLETED' || status === 'DELIVERED';
    const allocation = await prisma.bookingAllocation.create({
      data: { bookingId: booking.id, offerId: offer.id, transporterId: winner.agency.id, tankersAllocated: nTankers, agreedFreight: accepted, status: status === 'COMPLETED' ? 'COMPLETED' : status === 'CONFIRMED' ? 'CONFIRMED' : 'IN_PROGRESS', createdAt: at(confirmedMs) },
    });

    const tripStatus = status as TripStatus;
    const reachIdx = FLOW.indexOf(status);
    const needsTanker = reachIdx >= FLOW.indexOf('VEHICLE_ASSIGNED');
    const needsDriver = reachIdx >= FLOW.indexOf('DRIVER_ASSIGNED');
    const tanker = needsTanker ? (winner.tankers.find((t) => t.capacityKl.toNumber() >= cap && !busyTankers.has(t.id)) ?? winner.tankers[0]) : null;
    const driver = needsDriver ? (winner.drivers.find((d) => !busyDrivers.has(d.id)) ?? winner.drivers[0]) : null;
    if (!done && tanker) busyTankers.add(tanker.id);
    if (!done && driver) busyDrivers.add(driver.id);
    if (!done && tanker) await prisma.tanker.update({ where: { id: tanker.id }, data: { status: 'ON_TRIP' } });

    const path = decodePolyline(route.polyline);
    const progress = status === 'IN_TRANSIT' ? 0.55 : done ? 1 : status === 'LOADING' ? 0 : null;
    const startMs = status === 'IN_TRANSIT' ? now - route.mins * 0.55 * 60_000 : loadingMs;
    const trip = await prisma.trip.create({
      data: {
        tripCode: await code('trip_code_seq', 'TRP', 7),
        allocationId: allocation.id,
        bookingId: booking.id,
        transporterId: winner.agency.id,
        tankerId: tanker?.id,
        driverId: driver?.id,
        status: status === 'CONFIRMED' ? 'SCHEDULED' : tripStatus,
        plannedDistanceKm: route.km,
        distanceTravelledKm: progress === null ? 0 : Math.round(route.km * progress * 100) / 100,
        isSimulated: true,
        startedAt: progress !== null ? at(startMs - 2 * 3600_000) : null,
        loadedAt: status === 'IN_TRANSIT' || done ? at(startMs) : null,
        deliveredAt: done ? at(startMs + route.mins * 60_000) : null,
        completedAt: status === 'COMPLETED' ? at(startMs + route.mins * 60_000 + DAY) : null,
        etaAt: status === 'IN_TRANSIT' ? at(now + route.mins * 0.45 * 60_000) : null,
        createdAt: at(confirmedMs),
      },
    });
    if (progress !== null) {
      const n = status === 'IN_TRANSIT' ? 14 : done ? 6 : 1;
      const pts: Prisma.TripTrackingCreateManyInput[] = [];
      for (let k = 0; k < n; k++) {
        const f = n === 1 ? 0 : (progress * k) / (n - 1);
        const { point, heading } = pointAlong(path as LatLng[], f);
        const recorded = status === 'IN_TRANSIT' ? now - (n - 1 - k) * ((route.mins * 0.55 * 60_000) / (n - 1)) : startMs + f * route.mins * 60_000;
        pts.push({ tripId: trip.id, latitude: Number(point.lat.toFixed(6)), longitude: Number(point.lng.toFixed(6)), heading, speedKmph: k === 0 ? 0 : 35 + ((k * 11) % 20), source: 'SIMULATED', recordedAt: at(Math.min(recorded, now)) });
      }
      await prisma.tripTracking.createMany({ data: pts });
      const last = pts[pts.length - 1];
      await prisma.trip.update({ where: { id: trip.id }, data: { lastLatitude: last.latitude, lastLongitude: last.longitude, lastGpsAt: last.recordedAt } });
    }
    if (done) deliveredBookings.push(booking.id);

    const inv = invoiceAmounts(accepted, settings);
    const invoice = await prisma.invoice.create({
      data: { invoiceNumber: await code('invoice_code_seq', 'INV-', 6), bookingId: booking.id, companyId: comp.company.id, freightAmount: inv.freight, platformFee: inv.platformFee, gstPercent: settings.gstPercent, gstAmount: inv.gst, totalAmount: inv.total, dueAt: dateOnly(loadingMs), issuedAt: at(confirmedMs), createdAt: at(confirmedMs) },
    });

    // Payments: completed = advance + balance (except one with balance outstanding); active = mixed.
    const payPlan: ('ADVANCE' | 'BALANCE' | 'FAILED')[] =
      status === 'COMPLETED' ? (idx === 5 ? ['ADVANCE'] : ['ADVANCE', 'BALANCE']) : status === 'DELIVERED' || status === 'IN_TRANSIT' || status === 'LOADING' || status === 'VEHICLE_ASSIGNED' ? ['ADVANCE'] : status === 'CONFIRMED' ? ['FAILED'] : [];
    let paid = new Prisma.Decimal(0);
    for (const [k, kind] of payPlan.entries()) {
      const amount = kind === 'BALANCE' ? inv.total.minus(paid) : inv.advance;
      const payMs = kind === 'BALANCE' ? startMs + route.mins * 60_000 + 2 * DAY : confirmedMs + 0.2 * DAY;
      const ok = kind !== 'FAILED';
      await prisma.payment.create({
        data: {
          bookingId: booking.id,
          companyId: comp.company.id,
          purpose: kind === 'BALANCE' ? 'BALANCE' : 'ADVANCE',
          amount,
          status: ok ? 'PAID' : 'FAILED',
          provider: 'MOCK',
          providerOrderId: `order_demo_${idx}_${k}`,
          providerPaymentId: ok ? `pay_demo_${idx}_${k}` : null,
          method: (['UPI', 'NETBANKING', 'CARD'] as const)[(idx + k) % 3],
          signatureVerified: ok,
          failureReason: ok ? null : 'Payment declined by bank (simulated)',
          receiptNumber: ok ? await code('receipt_code_seq', 'RCP-', 6) : null,
          paidAt: ok ? at(Math.min(payMs, now - 3600_000)) : null,
          gatewayPayload: { demo: true },
          createdById: comp.user.id,
          createdAt: at(Math.min(payMs, now - 3600_000)),
        },
      });
      if (ok) paid = paid.plus(amount);
    }
    const full = paid.greaterThanOrEqualTo(inv.total);
    await prisma.booking.update({ where: { id: booking.id }, data: { paymentStatus: full ? 'PAID' : paid.greaterThan(0) ? 'ADVANCE_PAID' : payPlan.includes('FAILED') ? 'FAILED' : 'PENDING' } });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: full ? 'PAID' : paid.greaterThan(0) ? 'PARTIALLY_PAID' : 'ISSUED' } });

    if (daysAgo < 8) {
      notifications.push({ userId: comp.user.id, companyId: comp.company.id, type: 'BOOKING_CONFIRMED', title: `Booking ${booking.bookingCode} confirmed`, message: `${winner.def.name} will transport your load for Rs ${accepted.toLocaleString('en-IN')}.`, bookingId: booking.id, link: `/company/bookings/${booking.id}/confirmation`, createdAt: at(confirmedMs), readAt: daysAgo > 3 ? at(confirmedMs + 3600_000) : null });
      if (status === 'IN_TRANSIT') notifications.push({ userId: comp.user.id, companyId: comp.company.id, type: 'LOADING_COMPLETED', title: 'Loading completed (demo)', message: `${booking.bookingCode} is loaded and on the way.`, bookingId: booking.id, link: `/company/trips/${trip.id}`, createdAt: at(startMs) });
      if (status === 'DELIVERED') notifications.push({ userId: comp.user.id, companyId: comp.company.id, type: 'DELIVERY_COMPLETED', title: 'Delivery completed (demo)', message: `${booking.bookingCode} has been delivered. Proof of delivery is in Documents.`, bookingId: booking.id, link: '/company/documents', createdAt: at(startMs + route.mins * 60_000) });
    }
  }

  for (const c of companies) {
    notifications.push({ userId: c.user.id, companyId: c.company.id, type: 'REGISTRATION_SUCCESSFUL', title: 'Welcome to TankerLink', message: `Your company ID is ${c.company.companyCode}.`, link: '/company/profile', createdAt: c.company.createdAt, readAt: c.company.createdAt });
  }
  notifications.push({ userId: companies[0].user.id, companyId: c0.id, type: 'PAYMENT_PENDING', title: 'Balance payment due (demo)', message: 'A completed trip has an outstanding balance. Pay from the Payments page.', link: '/company/payments', createdAt: at(now - 2 * DAY) });
  await prisma.notification.createMany({ data: notifications });

  // Delivery proofs (simulated) for delivered/completed trips.
  for (const bookingId of deliveredBookings) {
    const trip = await prisma.trip.findFirstOrThrow({ where: { bookingId } });
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { bookingCode: true } });
    const pdf = await demoDeliveryProofPdf(bookingId);
    const key = await storage.put('trip-documents', pdf, 'pdf');
    await prisma.tripDocument.create({ data: { tripId: trip.id, bookingId, type: 'DELIVERY_PROOF', title: 'Proof of delivery (simulated)', fileName: `${booking.bookingCode}-POD.pdf`, storageKey: key, mimeType: 'application/pdf', sizeBytes: pdf.length, isDemo: true, createdAt: trip.deliveredAt ?? new Date() } });
  }

  // A sample support ticket.
  const completed = await prisma.booking.findFirst({ where: { companyId: c0.id, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } });
  await prisma.supportTicket.create({
    data: { ticketNumber: await code('ticket_code_seq', 'TKT', 6), companyId: c0.id, bookingId: completed?.id, category: 'VEHICLE_DELAY', subject: 'Tanker reached 5 hours late (demo)', description: 'The tanker reached the delivery point five hours after the committed time. Please review with the transporter. (Demo ticket)', status: 'RESOLVED', resolutionNote: 'Transporter cited a highway closure. Penalty waived as a one-time exception. (Demo)', resolvedAt: at(now - 20 * DAY), createdById: companies[0].user.id, createdAt: at(now - 25 * DAY) },
  });

  const providers = [...new Set([...routeCache.values()].map((r) => r.provider))];
  console.log('\nDemo data created (all names end in "(Demo)").');
  console.log(`  Routes from: ${providers.join(', ')}`);
  console.log('  Demo company logins (password for all: ' + DEMO_PASSWORD + '):');
  companies.forEach((c) => console.log(`   - ${c.company.companyCode}  ${c.company.name}  ${c.phone} / ${c.email}${c.company.status !== 'VERIFIED' ? '  [pending verification]' : ''}`));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
