import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { prisma } from '../src/lib/prisma';
import { getMockOtp } from '../src/modules/otp/providers/mock.provider';
import { buildGstin } from '../src/utils/gst';
import { sweepExpiringDocuments } from '../src/modules/transporter/alerts.service';
import { createBooking, emailVerificationToken, registerCompany } from './company-helpers';
import { api, bearer, createSuperAdmin, mobile, PASSWORD, phoneVerificationToken, uniqueEmail, uniqueLicence, uniquePan, uniquePhone } from './helpers';

const V1 = '/api/v1';
const PDF = Buffer.from('%PDF-1.4 test');
const inDays = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
let previousPortals: string;

beforeAll(() => {
  previousPortals = env.ENABLED_PORTALS;
  (env as { ENABLED_PORTALS: string }).ENABLED_PORTALS = 'company,admin,transporter,driver';
});
afterAll(() => {
  (env as { ENABLED_PORTALS: string }).ENABLED_PORTALS = previousPortals;
});

async function registerTransporter(overrides: Record<string, unknown> = {}) {
  const phone = uniquePhone();
  const email = uniqueEmail('transporter');
  const pan = uniquePan();
  const res = await api().post(`${V1}/transporters/register`).set(mobile).send({
    companyName: 'Sahyadri Bulk Carriers', ownerName: 'Vikram Jadhav', phone, email, password: PASSWORD, confirmPassword: PASSWORD,
    gstNumber: buildGstin('27', pan), panNumber: pan, businessType: 'FLEET_OWNER', address: '22 Transport Nagar, Nigdi', city: 'Pune', state: 'Maharashtra', pincode: '411044',
    operatingCities: ['Pune', 'Mumbai'], operatingStates: ['Maharashtra'], preferredRoutes: ['Pune-Mumbai'], numberOfTankers: 3, capacityCategories: ['20'], productCategories: ['LUBRICATING_OIL'],
    bank: { accountHolder: 'Sahyadri Bulk Carriers', bankName: 'HDFC Bank', accountNumber: '50100123456789', ifsc: 'HDFC0001234', accountType: 'CURRENT' },
    acceptTerms: true, phoneVerificationToken: await phoneVerificationToken(phone), emailVerificationToken: await emailVerificationToken(email), ...overrides,
  });
  return { res, phone, email, token: res.body?.data?.accessToken as string, id: res.body?.data?.transporter?.id as string };
}

const approveAgency = (id: string) => prisma.agency.update({ where: { id }, data: { verificationStatus: 'APPROVED', verifiedAt: new Date() } });

async function addTanker(token: string, overrides: Record<string, unknown> = {}) {
  const product = await prisma.product.findUniqueOrThrow({ where: { code: 'LUBRICATING_OIL' } });
  const type = await prisma.tankerType.findUniqueOrThrow({ where: { code: 'SS_TANKER' } });
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const reg = `MH12${letters[Math.floor(Math.random() * 23)]}${letters[Math.floor(Math.random() * 23)]}${1000 + Math.floor(Math.random() * 8999)}`;
  return api().post(`${V1}/tankers`).set(bearer(token)).send({ registrationNumber: reg, vehicleMake: 'Tata', vehicleModel: 'Signa 3518', manufacturingYear: 2022, capacityKl: 20, tankerTypeId: type.id, compartments: 2, compartmentCapacities: [12, 8], productIds: [product.id], gpsDeviceId: `DEV-${reg}`, ...overrides });
}

const driverBody = () => ({ fullName: 'Santosh More', phone: uniquePhone(), licenceNumber: uniqueLicence(), address: 'Bhosari, Pune 411026', licenceType: 'HGMV', licenceExpiry: inDays(800), hazardousTraining: 'VALID', hazardousTrainingExpiry: inDays(400), emergencyContactName: 'Sunita More', emergencyContactPhone: '9822334455', employmentStatus: 'ACTIVE' });

async function loginWithOtp(phone: string) {
  await api().post(`${V1}/auth/login/otp/send`).send({ phone }).expect(200);
  const res = await api().post(`${V1}/auth/login/otp/verify`).set(mobile).send({ phone, code: getMockOtp(phone)! }).expect(200);
  return { token: res.body.data.accessToken as string, redirectTo: res.body.data.redirectTo as string };
}

/** A verified transporter with an approved tanker and driver who has signed in. */
async function readyTransporter() {
  const t = await registerTransporter();
  expect(t.res.status).toBe(201);
  await approveAgency(t.id);
  const tanker = (await addTanker(t.token)).body.data.tanker;
  await prisma.tanker.update({ where: { id: tanker.id }, data: { verificationStatus: 'APPROVED' } });
  const body = driverBody();
  const driver = (await api().post(`${V1}/transporters/me/drivers`).set(bearer(t.token)).send(body).expect(201)).body.data.driver;
  await prisma.driver.update({ where: { id: driver.id }, data: { verificationStatus: 'APPROVED' } });
  await api().post(`${V1}/transporters/me/drivers/${driver.id}/invite`).set(bearer(t.token)).expect(200);
  // The invite has already issued the login code for this phone.
  const res = await api().post(`${V1}/auth/login/otp/verify`).set(mobile).send({ phone: body.phone, code: getMockOtp(body.phone)! }).expect(200);
  return { ...t, tankerId: tanker.id as string, driverId: driver.id as string, driverToken: res.body.data.accessToken as string, driverRedirect: res.body.data.redirectTo as string, driverPhone: body.phone };
}

async function bookingFor(companyToken: string, overrides: Record<string, unknown> = {}) {
  const res = await createBooking(companyToken, overrides);
  expect(res.status).toBe(201);
  return res.body.data.booking as { id: string; bookingCode: string };
}

/** Booking confirmed through the real negotiation path. */
async function confirmedBooking(t: Awaited<ReturnType<typeof readyTransporter>>, companyToken: string, overrides: Record<string, unknown> = {}) {
  const b = await bookingFor(companyToken, overrides);
  const offer = await api().post(`${V1}/bookings/${b.id}/offers`).set(bearer(t.token)).send({ mode: 'ACCEPT', tankers: 1 }).expect(201);
  await api().post(`${V1}/offers/${offer.body.data.offerId}/accept`).set(bearer(companyToken)).expect(200);
  const trip = await prisma.trip.findFirstOrThrow({ where: { bookingId: b.id } });
  return { booking: b, offerId: offer.body.data.offerId as string, tripId: trip.id };
}

describe('Module 1-2: registration, verification and login', () => {
  it('registers a transporter with a TRP id, encrypted bank details and pending status', async () => {
    const t = await registerTransporter();
    expect(t.res.status).toBe(201);
    expect(t.res.body.data.transporter.transporterCode).toMatch(/^TRP\d{6}$/);
    const account = await prisma.transporterBankAccount.findFirstOrThrow({ where: { transporterId: t.id } });
    expect(account.accountNumberEnc).not.toContain('50100123456789');
    const me = await api().get(`${V1}/transporters/me`).set(bearer(t.token)).expect(200);
    expect(me.body.data.transporter.verificationStatus).toBe('PENDING_VERIFICATION');
    expect(me.body.data.transporter.bank.accountLast4).toBe('6789');
    expect(JSON.stringify(me.body)).not.toContain('50100123456789');
    expect(JSON.stringify(me.body)).not.toContain('accountNumberEnc');
  });

  it('rejects a duplicate PAN/GST and an unverified phone token', async () => {
    const pan = uniquePan();
    await registerTransporter({ panNumber: pan, gstNumber: buildGstin('27', pan) });
    const dup = await registerTransporter({ panNumber: pan, gstNumber: buildGstin('27', pan) });
    expect(dup.res.status).toBe(409);
    const bad = await registerTransporter({ phoneVerificationToken: 'x'.repeat(40) });
    expect(bad.res.status).toBeGreaterThanOrEqual(400);
  });

  it('signs in by password and OTP, lands on the portal, and blocks suspended transporters', async () => {
    const t = await registerTransporter();
    const pw = await api().post(`${V1}/auth/login`).set(mobile).send({ identifier: t.phone, password: PASSWORD }).expect(200);
    expect(pw.body.data.redirectTo).toBe('/transporter/dashboard');
    const otp = await loginWithOtp(t.phone);
    expect(otp.redirectTo).toBe('/transporter/dashboard');
    await prisma.agency.update({ where: { id: t.id }, data: { verificationStatus: 'SUSPENDED' } });
    const blocked = await api().post(`${V1}/auth/login`).set(mobile).send({ identifier: t.email, password: PASSWORD });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('TRANSPORTER_SUSPENDED');
    const api403 = await api().get(`${V1}/transporters/me`).set(bearer(t.token));
    expect(api403.status).toBe(403);
  });

  it('uploads documents by real file type only', async () => {
    const t = await registerTransporter();
    await api().post(`${V1}/transporters/me/documents`).set(bearer(t.token)).field('docType', 'GST_CERTIFICATE').attach('file', PDF, 'gst.pdf').expect(201);
    const fake = await api().post(`${V1}/transporters/me/documents`).set(bearer(t.token)).field('docType', 'PAN_DOCUMENT').attach('file', Buffer.from('<script>'), 'pan.pdf');
    expect(fake.status).toBe(400);
    const v = await api().get(`${V1}/transporters/me/verification`).set(bearer(t.token)).expect(200);
    expect(v.body.data.documents).toHaveLength(1);
    expect(v.body.data.canBid).toBe(false);
  });

  it('requires an OTP to change bank details and audits the change', async () => {
    const t = await registerTransporter();
    const body = { accountHolder: 'Sahyadri', bankName: 'ICICI', accountNumber: '123456789012', ifsc: 'ICIC0001234', accountType: 'CURRENT' };
    expect((await api().put(`${V1}/transporters/me/bank`).set(bearer(t.token)).send({ ...body, code: '000000' })).status).toBeGreaterThanOrEqual(400);
    await api().post(`${V1}/transporters/me/bank/send-otp`).set(bearer(t.token)).expect(200);
    const r = await api().put(`${V1}/transporters/me/bank`).set(bearer(t.token)).send({ ...body, code: getMockOtp(t.phone)! }).expect(200);
    expect(r.body.data.bank.status).toBe('PENDING_REVIEW');
    expect(await prisma.transporterBankAccount.count({ where: { transporterId: t.id } })).toBe(2);
    expect(await prisma.transporterBankAccount.count({ where: { transporterId: t.id, isCurrent: true } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'transporter.bank_changed', entityId: t.id } })).toBe(1);
  });
});

describe('Module 4-6: marketplace and negotiation', () => {
  it('hides bookings until verified with a verified compatible free tanker', async () => {
    const company = await registerCompany();
    const b = await bookingFor(company.token);
    const t = await registerTransporter();
    const seen = async () => (await api().get(`${V1}/marketplace/bookings`).set(bearer(t.token)).expect(200)).body.data.items.map((i: { id: string }) => i.id);
    expect(await seen()).not.toContain(b.id);
    const denied = await api().post(`${V1}/bookings/${b.id}/offers`).set(bearer(t.token)).send({ mode: 'ACCEPT', tankers: 1 });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('TRANSPORTER_NOT_VERIFIED');
    await approveAgency(t.id);
    const tanker = (await addTanker(t.token)).body.data.tanker;
    expect(await seen()).not.toContain(b.id); // tanker not yet verified by admin
    await prisma.tanker.update({ where: { id: tanker.id }, data: { verificationStatus: 'APPROVED' } });
    expect(await seen()).toContain(b.id);
    await api().put(`${V1}/tankers/${tanker.id}/availability`).set(bearer(t.token)).send({ status: 'MAINTENANCE' }).expect(200);
    expect(await seen()).not.toContain(b.id);
    await api().put(`${V1}/tankers/${tanker.id}/availability`).set(bearer(t.token)).send({ status: 'AVAILABLE', block: { kind: 'BLOCKED', startAt: new Date(Date.now() + 86400_000).toISOString(), endAt: new Date(Date.now() + 5 * 86400_000).toISOString() } }).expect(200);
    expect(await seen()).not.toContain(b.id); // blocked for the loading window
  });

  it('runs accept-at-customer-price without confirming the booking', async () => {
    const company = await registerCompany();
    const t = await readyTransporter();
    const b = await bookingFor(company.token);
    const r = await api().post(`${V1}/bookings/${b.id}/offers`).set(bearer(t.token)).send({ mode: 'ACCEPT', tankers: 1 }).expect(201);
    expect(r.body.data.status).toBe('PENDING');
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(booking.status).toBe('OFFERS_RECEIVED');
    expect(await prisma.bookingAllocation.count({ where: { bookingId: b.id } })).toBe(0);
    const dup = await api().post(`${V1}/bookings/${b.id}/offers`).set(bearer(t.token)).send({ mode: 'ACCEPT', tankers: 1 });
    expect(dup.status).toBeGreaterThanOrEqual(400);
  });

  it('negotiates over multiple rounds with a full private history', async () => {
    const company = await registerCompany();
    const t = await readyTransporter();
    const b = await bookingFor(company.token);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    const high = Math.round(row.customerOffer.toNumber() * 1.1);
    const offerId = (await api().post(`${V1}/bookings/${b.id}/offers`).set(bearer(t.token)).send({ mode: 'COUNTER', amount: high, tankers: 1 }).expect(201)).body.data.offerId;
    const mid = high - 500;
    await api().post(`${V1}/offers/${offerId}/counter`).set(bearer(company.token)).send({ amount: mid }).expect(200);
    await api().post(`${V1}/offers/${offerId}/counter`).set(bearer(t.token)).send({ amount: mid + 200 }).expect(200);
    await api().post(`${V1}/offers/${offerId}/counter`).set(bearer(company.token)).send({ amount: mid + 100 }).expect(200);
    await api().post(`${V1}/offers/${offerId}/accept`).set(bearer(t.token)).expect(200);
    const seen = await api().get(`${V1}/offers/${offerId}`).set(bearer(t.token)).expect(200);
    expect(seen.body.data.history.map((h: { party: string }) => h.party)).toEqual(['TRANSPORTER', 'COMPANY', 'TRANSPORTER', 'COMPANY', 'TRANSPORTER']);
    expect(seen.body.data.offer.status).toBe('PENDING');
    await api().post(`${V1}/offers/${offerId}/accept`).set(bearer(company.token)).expect(200);
    const alloc = await prisma.bookingAllocation.findFirstOrThrow({ where: { bookingId: b.id } });
    expect(alloc.agreedFreight.toNumber()).toBe(mid + 100);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('CONFIRMED');
  });

  it('isolates each transporter’s private negotiation and refuses expired or foreign actions', async () => {
    const company = await registerCompany();
    const [a, other] = [await readyTransporter(), await readyTransporter()];
    const b = await bookingFor(company.token);
    const offerA = (await api().post(`${V1}/bookings/${b.id}/offers`).set(bearer(a.token)).send({ mode: 'ACCEPT', tankers: 1 }).expect(201)).body.data.offerId;
    await api().post(`${V1}/bookings/${b.id}/offers`).set(bearer(other.token)).send({ mode: 'ACCEPT', tankers: 1 }).expect(201);
    expect((await api().get(`${V1}/offers/${offerA}`).set(bearer(other.token))).status).toBe(404);
    expect((await api().post(`${V1}/offers/${offerA}/withdraw`).set(bearer(other.token)).send({})).status).toBe(404);
    await api().post(`${V1}/offers/${offerA}/counter`).set(bearer(company.token)).send({ amount: (await prisma.transporterOffer.findUniqueOrThrow({ where: { id: offerA } })).currentAmount.toNumber() - 100 }).expect(200);
    await prisma.transporterOffer.update({ where: { id: offerA }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await api().post(`${V1}/offers/${offerA}/accept`).set(bearer(a.token)).send({});
    expect(expired.status).toBe(409);
    expect(expired.body.error.code).toBe('OFFER_EXPIRED');
  });

  it('closes offers when the booking is cancelled, and supports reject and withdraw', async () => {
    const company = await registerCompany();
    const t = await readyTransporter();
    const b = await bookingFor(company.token);
    const offerId = (await api().post(`${V1}/bookings/${b.id}/offers`).set(bearer(t.token)).send({ mode: 'ACCEPT', tankers: 1 }).expect(201)).body.data.offerId;
    await api().post(`${V1}/bookings/${b.id}/cancel`).set(bearer(company.token)).send({ reason: 'Plant shutdown this week' }).expect(200);
    const o = await prisma.transporterOffer.findUniqueOrThrow({ where: { id: offerId } });
    expect(o.status).toBe('UNSUCCESSFUL');
    expect((await api().post(`${V1}/offers/${offerId}/withdraw`).set(bearer(t.token)).send({})).status).toBe(409);
  });

  it('supports partial fulfilment with a pro-rated customer price', async () => {
    const company = await registerCompany();
    const t = await readyTransporter();
    const b = await bookingFor(company.token, { numberOfTankers: 2, quantityKl: 40 });
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    const r = await api().post(`${V1}/bookings/${b.id}/offers`).set(bearer(t.token)).send({ mode: 'ACCEPT', tankers: 1 }).expect(201);
    expect(r.body.data.amount).toBeCloseTo(row.customerOffer.toNumber() / 2, 2);
    const tooMany = await api().post(`${V1}/bookings/${(await bookingFor(company.token, { numberOfTankers: 2, quantityKl: 40 })).id}/offers`).set(bearer(t.token)).send({ mode: 'ACCEPT', tankers: 2 });
    expect(tooMany.status).toBe(409); // only one free compatible tanker
  });
});

describe('Modules 7-13: assignment, trip engine, driver sub-login, tracking', () => {
  it('runs the complete workflow from booking to settlement', async () => {
    const company = await registerCompany();
    const t = await readyTransporter();
    expect(t.driverRedirect).toBe('/driver/dashboard');
    const { booking, tripId } = await confirmedBooking(t, company.token);

    // Driver must not act before assignment; tanker comes before driver.
    expect((await api().get(`${V1}/driver/me/trips/${tripId}`).set(bearer(t.driverToken))).status).toBe(404);
    const early = await api().post(`${V1}/bookings/${booking.id}/assign-driver`).set(bearer(t.token)).send({ tripId, driverId: t.driverId });
    expect(early.status).toBe(409);
    await api().post(`${V1}/bookings/${booking.id}/assign-tanker`).set(bearer(t.token)).send({ tripId, tankerId: t.tankerId }).expect(200);
    await api().post(`${V1}/bookings/${booking.id}/assign-driver`).set(bearer(t.token)).send({ tripId, driverId: t.driverId }).expect(200);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('DRIVER_ASSIGNED');

    const mine = await api().get(`${V1}/driver/me/trips`).set(bearer(t.driverToken)).expect(200);
    expect(mine.body.data.items[0].id).toBe(tripId);
    expect(JSON.stringify(mine.body)).not.toMatch(/freight|customerOffer|commission/i);

    const step = (action: string, extra: Record<string, unknown> = {}) => api().post(`${V1}/driver/me/trips/${tripId}/status`).set(bearer(t.driverToken)).send({ action, ...extra });
    // Out-of-order steps are refused by the engine.
    expect((await step('START_TRIP')).status).toBe(409);
    for (const a of ['CONFIRM_ASSIGNMENT', 'REACHED_PICKUP', 'START_LOADING', 'COMPLETE_LOADING', 'START_TRIP']) (await step(a, { latitude: 18.76, longitude: 73.86, remarks: `step ${a}` })).status === 200 || expect.fail(a);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('IN_TRANSIT');
    expect((await prisma.tanker.findUniqueOrThrow({ where: { id: t.tankerId } })).status).toBe('IN_TRANSIT');

    const at = new Date().toISOString();
    await api().post(`${V1}/driver/me/trips/${tripId}/location`).set(bearer(t.driverToken)).send({ points: [{ latitude: 18.9, longitude: 73.4, speedKmph: 42, heading: 280, recordedAt: at }] }).expect(200);
    const tracking = await api().get(`${V1}/trips/${tripId}/tracking`).set(bearer(company.token)).expect(200);
    expect(tracking.body.data.tracking.dataSource).toBe('GPS');
    expect(tracking.body.data.tracking.currentPosition.lat).toBe(18.9);
    const ownView = await api().get(`${V1}/trips/${tripId}/tracking`).set(bearer(t.token)).expect(200);
    expect(ownView.body.data.tracking.tripId).toBe(tripId);
    const vehicles = await api().get(`${V1}/transporters/me/active-vehicles`).set(bearer(t.token)).expect(200);
    expect(vehicles.body.data.vehicles[0].position.lat).toBe(18.9);
    const companyTrips = await api().get(`${V1}/trips?scope=active`).set(bearer(company.token)).expect(200);
    expect(companyTrips.body.data.trips.map((x: { id: string }) => x.id)).toContain(tripId);

    for (const a of ['REACHED_DELIVERY', 'START_UNLOADING', 'COMPLETE_UNLOADING']) expect((await step(a)).status).toBe(200);
    const noPod = await step('SUBMIT_COMPLETION');
    expect(noPod.status).toBe(409);
    await api().post(`${V1}/driver/me/trips/${tripId}/documents`).set(bearer(t.driverToken)).field('type', 'DELIVERY_PROOF').attach('file', PDF, 'pod.pdf').expect(201);
    expect((await step('SUBMIT_COMPLETION')).status).toBe(200);
    expect((await prisma.settlement.findFirstOrThrow({ where: { transporterId: t.id } })).status).toBe('ON_HOLD');

    await api().post(`${V1}/trips/${tripId}/complete`).set(bearer(t.token)).send({}).expect(200);
    const released = await prisma.tanker.findUniqueOrThrow({ where: { id: t.tankerId } });
    expect(released.status).toBe('AVAILABLE');
    expect(released.availableLocation).toContain('Mumbai'); // released at delivery, not its original pickup
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('COMPLETED');

    const history = await api().get(`${V1}/trips/${tripId}/history`).set(bearer(t.token)).expect(200);
    expect(history.body.data.history.length).toBeGreaterThanOrEqual(12);
    expect(history.body.data.history.find((h: { newStatus: string }) => h.newStatus === 'LOADING').location.lat).toBe(18.76);

    const e = await api().get(`${V1}/transporters/me/earnings`).set(bearer(t.token)).expect(200);
    const alloc = await prisma.bookingAllocation.findFirstOrThrow({ where: { bookingId: booking.id } });
    const c = await prisma.bookingCommission.findUniqueOrThrow({ where: { allocationId: alloc.id } });
    expect(e.body.data.summary.totalFreight).toBe(alloc.agreedFreight.toNumber());
    expect(e.body.data.summary.platformCommission).toBe(c.commissionAmount.toNumber());
    expect(e.body.data.items[0].settlementStatus).toBe('PENDING');
    const dash = await api().get(`${V1}/transporters/dashboard`).set(bearer(t.token)).expect(200);
    expect(dash.body.data.cards.completedTrips).toBe(1);
    expect(dash.body.data.cards.pendingSettlements).toBe(c.transporterPayable.toNumber());
    const notes = await api().get(`${V1}/notifications`).set(bearer(t.token)).expect(200);
    expect(notes.body.data.items.map((n: { type: string }) => n.type)).toEqual(expect.arrayContaining(['BOOKING_CONFIRMED', 'OFFER_SUBMITTED', 'TRIP_COMPLETED']));
  });

  it('prevents overlapping tanker and driver assignments, even concurrently', async () => {
    const company = await registerCompany();
    const t = await readyTransporter();
    const a = await confirmedBooking(t, company.token);
    // Two offers for one tanker are allowed; only one can win the tanker for overlapping dates.
    const booking2 = await bookingFor(company.token);
    const offer2 = await api().post(`${V1}/bookings/${booking2.id}/offers`).set(bearer(t.token)).send({ mode: 'ACCEPT', tankers: 1 }).expect(201);
    await api().post(`${V1}/offers/${offer2.body.data.offerId}/accept`).set(bearer(company.token)).expect(200);
    const trip2 = await prisma.trip.findFirstOrThrow({ where: { bookingId: booking2.id } });
    const results = await Promise.all([
      api().post(`${V1}/bookings/${a.booking.id}/assign-tanker`).set(bearer(t.token)).send({ tripId: a.tripId, tankerId: t.tankerId }),
      api().post(`${V1}/bookings/${booking2.id}/assign-tanker`).set(bearer(t.token)).send({ tripId: trip2.id, tankerId: t.tankerId }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.trip.count({ where: { tankerId: t.tankerId } })).toBe(1);
  });

  it('enforces the same no-overlap rule in the database itself', async () => {
    const company = await registerCompany();
    const t = await readyTransporter();
    const a = await confirmedBooking(t, company.token);
    const b2 = await bookingFor(company.token);
    const o2 = await api().post(`${V1}/bookings/${b2.id}/offers`).set(bearer(t.token)).send({ mode: 'ACCEPT', tankers: 1 }).expect(201);
    await api().post(`${V1}/offers/${o2.body.data.offerId}/accept`).set(bearer(company.token)).expect(200);
    const t2 = await prisma.trip.findFirstOrThrow({ where: { bookingId: b2.id } });
    const window = { plannedStartAt: new Date(Date.now() + 86400_000), plannedEndAt: new Date(Date.now() + 3 * 86400_000) };
    await prisma.trip.update({ where: { id: a.tripId }, data: { tankerId: t.tankerId, status: 'VEHICLE_ASSIGNED', ...window } });
    await expect(prisma.trip.update({ where: { id: t2.id }, data: { tankerId: t.tankerId, status: 'VEHICLE_ASSIGNED', ...window } })).rejects.toThrow(/trips_tanker_no_overlap/);
  });

  it('refuses non-compliant assignments', async () => {
    const company = await registerCompany();
    const t = await readyTransporter();
    const { booking, tripId } = await confirmedBooking(t, company.token);
    await prisma.tanker.update({ where: { id: t.tankerId }, data: { insuranceExpiry: new Date(Date.now() + 3600_000) } });
    const expired = await api().post(`${V1}/bookings/${booking.id}/assign-tanker`).set(bearer(t.token)).send({ tripId, tankerId: t.tankerId });
    expect(expired.status).toBe(409);
    await prisma.tanker.update({ where: { id: t.tankerId }, data: { insuranceExpiry: null } });
    await api().post(`${V1}/bookings/${booking.id}/assign-tanker`).set(bearer(t.token)).send({ tripId, tankerId: t.tankerId }).expect(200);
    await prisma.driver.update({ where: { id: t.driverId }, data: { licenceExpiry: new Date(Date.now() + 3600_000) } });
    const r = await api().post(`${V1}/bookings/${booking.id}/assign-driver`).set(bearer(t.token)).send({ tripId, driverId: t.driverId });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('NOT_COMPLIANT');
  });

  it('never lets a transporter set compliance or verification on its own tanker', async () => {
    const t = await registerTransporter();
    const res = await addTanker(t.token, { verificationStatus: 'APPROVED' });
    expect(res.status).toBe(400);
    const made = await addTanker(t.token);
    expect(made.body.data.tanker.verificationStatus).toBe('PENDING_VERIFICATION');
    expect((await api().put(`${V1}/tankers/${made.body.data.tanker.id}`).set(bearer(t.token)).send({ verificationStatus: 'APPROVED' })).status).toBe(400);
    expect((await api().put(`${V1}/tankers/${made.body.data.tanker.id}/availability`).set(bearer(t.token)).send({ status: 'SUSPENDED' })).status).toBe(400);
  });
});

describe('Isolation and access control', () => {
  it('keeps transporters out of each other’s records', async () => {
    const company = await registerCompany();
    const [a, b] = [await readyTransporter(), await readyTransporter()];
    const { booking, tripId } = await confirmedBooking(a, company.token);
    expect((await api().get(`${V1}/tankers/${a.tankerId}`).set(bearer(b.token))).status).toBe(404);
    expect((await api().put(`${V1}/tankers/${a.tankerId}`).set(bearer(b.token)).send({ vehicleMake: 'Hacked' })).status).toBe(404);
    expect((await api().get(`${V1}/transporters/me/drivers/${a.driverId}`).set(bearer(b.token))).status).toBe(404);
    expect((await api().get(`${V1}/trips/${tripId}`).set(bearer(b.token))).status).toBe(404);
    expect((await api().get(`${V1}/trips/${tripId}/tracking`).set(bearer(b.token))).status).toBe(404);
    expect((await api().post(`${V1}/bookings/${booking.id}/assign-tanker`).set(bearer(b.token)).send({ tripId, tankerId: b.tankerId })).status).toBe(404);
    // Another transporter's tanker cannot be assigned to my own trip.
    expect((await api().post(`${V1}/bookings/${booking.id}/assign-tanker`).set(bearer(a.token)).send({ tripId, tankerId: b.tankerId })).status).toBe(404);
    expect((await api().get(`${V1}/transporters/me/earnings`).set(bearer(b.token)).expect(200)).body.data.items).toHaveLength(0);
  });

  it('confines drivers to their assigned trips and own API surface', async () => {
    const company = await registerCompany();
    const [a, b] = [await readyTransporter(), await readyTransporter()];
    const { booking, tripId } = await confirmedBooking(a, company.token);
    await api().post(`${V1}/bookings/${booking.id}/assign-tanker`).set(bearer(a.token)).send({ tripId, tankerId: a.tankerId }).expect(200);
    await api().post(`${V1}/bookings/${booking.id}/assign-driver`).set(bearer(a.token)).send({ tripId, driverId: a.driverId }).expect(200);
    expect((await api().get(`${V1}/driver/me/trips/${tripId}`).set(bearer(b.driverToken))).status).toBe(404);
    expect((await api().post(`${V1}/driver/me/trips/${tripId}/status`).set(bearer(b.driverToken)).send({ action: 'CONFIRM_ASSIGNMENT' })).status).toBe(404);
    expect((await api().post(`${V1}/driver/me/trips/${tripId}/location`).set(bearer(b.driverToken)).send({ points: [{ latitude: 1, longitude: 1, recordedAt: new Date().toISOString() }] })).status).toBe(404);
    for (const path of ['/transporters/me/earnings', '/transporters/me', '/marketplace/bookings', '/tankers', '/transporters/me/drivers', '/companies/profile', '/admin/dashboard']) {
      const r = await api().get(`${V1}${path}`).set(bearer(a.driverToken));
      expect([401, 403, 404]).toContain(r.status);
    }
    const bid = await bookingFor(company.token);
    expect((await api().post(`${V1}/bookings/${bid.id}/offers`).set(bearer(a.driverToken)).send({ mode: 'ACCEPT', tankers: 1 })).status).toBeGreaterThanOrEqual(403);
    expect((await api().post(`${V1}/driver/me/trips/${tripId}/location`).set(bearer(a.driverToken)).send({ points: [{ latitude: 18, longitude: 73, recordedAt: new Date().toISOString() }] })).status).toBe(409); // not yet accepted
  });

  it('ends a suspended driver’s session immediately', async () => {
    const t = await readyTransporter();
    await api().get(`${V1}/driver/me`).set(bearer(t.driverToken)).expect(200);
    await api().put(`${V1}/transporters/me/drivers/${t.driverId}/status`).set(bearer(t.token)).send({ action: 'SUSPEND' }).expect(200);
    expect([401, 403]).toContain((await api().get(`${V1}/driver/me`).set(bearer(t.driverToken))).status);
    const otp = await api().post(`${V1}/auth/login/otp/send`).send({ phone: t.driverPhone });
    expect(otp.status).toBe(200);
  });

  it('has no route that lets a transporter write financial records', async () => {
    const company = await registerCompany();
    const t = await readyTransporter();
    await confirmedBooking(t, company.token);
    const s = await prisma.settlement.findFirstOrThrow({ where: { transporterId: t.id } });
    for (const [m, path] of [['post', `/admin/commissions/settlements/${s.id}/settle`], ['put', `/transporters/me/settlements/${s.id}`], ['put', '/transporters/me/commissions']] as const) {
      const r = await api()[m](`${V1}${path}`).set(bearer(t.token)).send({ status: 'SETTLED', amount: 1, reference: 'X' });
      expect([401, 403, 404]).toContain(r.status);
    }
    expect((await prisma.settlement.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('ON_HOLD');
  });

  it('does not change company-side access to shared paths', async () => {
    const company = await registerCompany();
    const t = await readyTransporter();
    const { offerId } = await confirmedBooking(t, company.token);
    expect((await api().get(`${V1}/offers/${offerId}`).set(bearer(company.token)).expect(200)).body.data.offer.id).toBe(offerId);
    expect((await api().get(`${V1}/transporters/${t.id}`).set(bearer(company.token)).expect(200)).body.data).toBeTruthy();
    expect((await api().get(`${V1}/notifications`).set(bearer(company.token))).status).toBe(200);
    expect((await api().get(`${V1}/support/tickets`).set(bearer(company.token))).status).toBe(200);
  });

  it('keeps the portals closed unless released', async () => {
    const t = await registerTransporter();
    (env as { ENABLED_PORTALS: string }).ENABLED_PORTALS = 'company';
    try {
      expect((await api().post(`${V1}/auth/login`).set(mobile).send({ identifier: t.phone, password: PASSWORD })).status).toBe(403);
      expect((await api().post(`${V1}/transporters/register`).set(mobile).send({})).status).toBe(404);
    } finally {
      (env as { ENABLED_PORTALS: string }).ENABLED_PORTALS = 'company,admin,transporter,driver';
    }
  });
});

describe('Modules 15-21: finance documents, reports, support, subscriptions', () => {
  it('generates every report from live data and exports Excel and PDF', async () => {
    const company = await registerCompany();
    const t = await readyTransporter();
    await confirmedBooking(t, company.token);
    const list = (await api().get(`${V1}/transporters/me/reports`).set(bearer(t.token)).expect(200)).body.data.reports as { key: string }[];
    expect(list).toHaveLength(27);
    for (const { key } of list) {
      const r = await api().get(`${V1}/transporters/me/reports/${key}`).set(bearer(t.token));
      expect(r.status, key).toBe(200);
      expect(Array.isArray(r.body.data.report.rows), key).toBe(true);
    }
    const xlsx = await api().get(`${V1}/transporters/me/reports/offers-submitted/export?format=xlsx`).set(bearer(t.token)).buffer().expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheet');
    const pdf = await api().get(`${V1}/transporters/me/reports/booking-earnings/export?format=pdf`).set(bearer(t.token)).expect(200);
    expect(pdf.headers['content-type']).toContain('pdf');
    expect((await api().get(`${V1}/transporters/me/reports/nope`).set(bearer(t.token))).status).toBe(404);
  });

  it('serves the document centre with secure downloads', async () => {
    const company = await registerCompany();
    const [t, other] = [await readyTransporter(), await readyTransporter()];
    await confirmedBooking(t, company.token);
    const docs = (await api().get(`${V1}/transporters/me/documents-centre`).set(bearer(t.token)).expect(200)).body.data.items as { type: string; href: string }[];
    expect(docs.map((d) => d.type)).toEqual(expect.arrayContaining(['BOOKING_CONFIRMATION', 'FREIGHT_INVOICE', 'SETTLEMENT_STATEMENT']));
    for (const d of docs) await api().get(`${V1}${d.href}`).set(bearer(t.token)).expect(200);
    expect((await api().get(`${V1}${docs[0].href}`).set(bearer(other.token))).status).toBe(404);
    await api().get(`${V1}/transporters/me/statement.pdf`).set(bearer(t.token)).expect(200);
  });

  it('raises tickets into the shared complaint tables and hides internal notes', async () => {
    const t = await readyTransporter();
    const other = await readyTransporter();
    const made = await api().post(`${V1}/support/tickets`).set(bearer(t.token)).field('category', 'GPS_ISSUE').field('subject', 'GPS not updating').field('description', 'The tracker has not reported for over an hour.').attach('attachments', PDF, 'log.pdf').expect(201);
    const id = made.body.data.ticket.id as string;
    expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id } })).raisedByType).toBe('TRANSPORTER');
    await prisma.complaintActivity.create({ data: { ticketId: id, type: 'NOTE', message: 'INTERNAL ONLY', internal: true } });
    await api().post(`${V1}/support/tickets/${id}/replies`).set(bearer(t.token)).field('message', 'Any update on this please?').expect(201);
    const seen = await api().get(`${V1}/support/tickets/${id}`).set(bearer(t.token)).expect(200);
    expect(JSON.stringify(seen.body)).not.toContain('INTERNAL ONLY');
    expect(seen.body.data.ticket.activities).toHaveLength(1);
    expect((await api().get(`${V1}/support/tickets/${id}`).set(bearer(other.token))).status).toBe(404);
    expect((await api().post(`${V1}/support/tickets/${id}/reopen`).set(bearer(t.token)).send({ reason: 'Still broken today' })).status).toBe(409);
    await prisma.supportTicket.update({ where: { id }, data: { status: 'RESOLVED' } });
    await api().post(`${V1}/support/tickets/${id}/reopen`).set(bearer(t.token)).send({ reason: 'Still broken today' }).expect(200);
  });

  it('alerts matching transporters about new bookings and lets admins answer their tickets', async () => {
    const company = await registerCompany();
    const t = await readyTransporter();
    const b = await bookingFor(company.token);
    await expect.poll(async () => prisma.notification.count({ where: { bookingId: b.id, type: 'NEW_BOOKING_AVAILABLE', user: { ownedAgency: { id: t.id } } } })).toBe(1);

    await prisma.tanker.update({ where: { id: t.tankerId }, data: { insuranceExpiry: new Date(Date.now() + 5 * 86400_000) } });
    await sweepExpiringDocuments();
    await sweepExpiringDocuments();
    expect(await prisma.notification.count({ where: { type: 'DOCUMENT_EXPIRY', user: { ownedAgency: { id: t.id } } } })).toBe(1);

    const ticket = (await api().post(`${V1}/support/tickets`).set(bearer(t.token)).field('category', 'GPS_ISSUE').field('subject', 'GPS not updating').field('description', 'The tracker has not reported for over an hour.').expect(201)).body.data.ticket;
    (env as { ENABLED_PORTALS: string }).ENABLED_PORTALS = 'all';
    const admin = await createSuperAdmin();
    (env as { ENABLED_PORTALS: string }).ENABLED_PORTALS = 'company,admin,transporter,driver';
    const listed = await api().get(`${V1}/admin/transporter-tickets`).set(bearer(admin.token)).expect(200);
    expect(listed.body.data.items.map((x: { id: string }) => x.id)).toContain(ticket.id);
    expect((await api().get(`${V1}/admin/transporter-tickets`).set(bearer(t.token))).status).toBe(403);
    await api().post(`${V1}/admin/transporter-tickets/${ticket.id}/respond`).set(bearer(admin.token)).send({ message: 'Staff-only remark', internal: true }).expect(200);
    await api().post(`${V1}/admin/transporter-tickets/${ticket.id}/respond`).set(bearer(admin.token)).send({ message: 'Device replaced, please check.', status: 'RESOLVED' }).expect(200);
    const seen = (await api().get(`${V1}/support/tickets/${ticket.id}`).set(bearer(t.token)).expect(200)).body.data.ticket;
    expect(seen.status).toBe('RESOLVED');
    expect(JSON.stringify(seen)).toContain('Device replaced');
    expect(JSON.stringify(seen)).not.toContain('Staff-only');
  });

  it('activates free plans, queues paid plans, and logs service requests', async () => {
    const t = await readyTransporter();
    const plans = (await api().get(`${V1}/subscription-plans`).set(bearer(t.token)).expect(200)).body.data.plans as { id: string; name: string; price: number }[];
    expect(plans.map((p) => p.name)).toEqual(expect.arrayContaining(['Free', 'Silver', 'Gold', 'Enterprise']));
    const free = await api().post(`${V1}/transporters/me/subscription-orders`).set(bearer(t.token)).send({ planId: plans.find((p) => p.price === 0)!.id }).expect(201);
    expect(free.body.data.subscription.status).toBe('ACTIVE');
    const gold = await api().post(`${V1}/transporters/me/subscription-orders`).set(bearer(t.token)).send({ planId: plans.find((p) => p.name === 'Gold')!.id }).expect(201);
    expect(gold.body.data.subscription.status).toBe('PENDING');
    const services = (await api().get(`${V1}/services`).set(bearer(t.token)).expect(200)).body.data.services as { id: string }[];
    await api().post(`${V1}/service-requests`).set(bearer(t.token)).send({ serviceId: services[0].id, requestType: 'CALLBACK' }).expect(201);
    expect((await api().get(`${V1}/service-requests`).set(bearer(t.token)).expect(200)).body.data.items).toHaveLength(1);
  });

  it('accepts GPS hardware only with the device key', async () => {
    (env as { GPS_INGEST_KEY?: string }).GPS_INGEST_KEY = 'x'.repeat(30);
    const body = { deviceId: 'nope', latitude: 18, longitude: 73, recordedAt: new Date().toISOString() };
    expect((await api().post(`${V1}/gps/ingest`).send(body)).status).toBe(401);
    expect((await api().post(`${V1}/gps/ingest`).set('X-GPS-Key', 'x'.repeat(30)).send(body)).status).toBe(404);
    delete (env as { GPS_INGEST_KEY?: string }).GPS_INGEST_KEY;
  });
});
