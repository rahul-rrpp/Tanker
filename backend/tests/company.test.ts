import { beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { prisma } from '../src/lib/prisma';
import { buildGstin, gstCheckChar, validateGstin } from '../src/utils/gst';
import { createBooking, createDemoTransporter, companyBody, registerCompany } from './company-helpers';
import { api, bearer, mobile, PASSWORD, registerCustomer, uniquePan } from './helpers';

beforeAll(async () => {
  // Enough compatible demo transporters for the negotiation tests.
  for (let i = 0; i < 4; i++) await createDemoTransporter('LUBRICATING_OIL', 20);
});

describe('GSTIN validation', () => {
  it('accepts a checksum-valid GSTIN and rejects a wrong check digit', () => {
    expect(validateGstin('27AAPFU0939F1ZV').valid).toBe(true);
    expect(validateGstin('27AAPFU0939F1ZA').valid).toBe(false);
    const g = buildGstin('24', 'AABCS1234D');
    expect(g[14]).toBe(gstCheckChar(g.slice(0, 14)));
    expect(validateGstin(g, 'Maharashtra')).toMatchObject({ valid: false });
    expect(validateGstin(g, 'Gujarat')).toMatchObject({ valid: true });
  });
});

describe('TEST 1 - company registration & login', () => {
  it('registers with mobile + email OTP, issues a sequential company ID and pending status', async () => {
    const { res } = await registerCompany();
    expect(res.status).toBe(201);
    expect(res.body.data.company.companyCode).toMatch(/^CMP\d{6}$/);
    expect(res.body.data.user.company.status).toBe('PENDING_VERIFICATION');
    expect(res.body.data.user.roles).toContain('COMPANY_ADMIN');
    expect(res.body.data.redirectTo).toBe('/company/dashboard');
  });

  it('rejects an invalid GSTIN, mismatched state and missing email verification', async () => {
    const bad = await api().post('/api/v1/auth/register').send(companyBody({ phone: '9876500001', email: 'x@example.com', gstNumber: '27AAPFU0939F1ZA', phoneVerificationToken: 'x'.repeat(20), emailVerificationToken: 'x'.repeat(20) }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.some((d: { field: string }) => d.field === 'gstNumber')).toBe(true);
    const missingEmail = await api().post('/api/v1/auth/register').send(companyBody({ phone: '9876500001', email: 'x@example.com', phoneVerificationToken: 'x'.repeat(20) }));
    expect(missingEmail.status).toBe(400);
  });

  it('prevents duplicate mobile, email and GST', async () => {
    const first = await registerCompany();
    const dupPhone = await registerCompany({ phone: first.phone }).catch((e) => e);
    // The OTP send itself refuses registered numbers.
    expect(dupPhone).toBeInstanceOf(Error);
    const gst = first.res.body.data.user.company ? (await prisma.company.findUniqueOrThrow({ where: { id: first.companyId } })).gstNumber : '';
    const dupGst = await registerCompany({ gstNumber: gst });
    expect(dupGst.res.status).toBe(409);
    expect(dupGst.res.body.error.code).toBe('GST_ALREADY_REGISTERED');
  });

  it('logs in with mobile or email, records login history, and supports OTP login', async () => {
    const { phone, email } = await registerCompany();
    const byPhone = await api().post('/api/v1/auth/login').set(mobile).send({ identifier: phone, password: PASSWORD }).expect(200);
    await api().post('/api/v1/auth/login').set(mobile).send({ identifier: email, password: PASSWORD }).expect(200);
    const history = await api().get('/api/v1/auth/login-history').set(bearer(byPhone.body.data.accessToken)).expect(200);
    expect(history.body.data.history.filter((h: { event: string }) => h.event === 'LOGIN_SUCCESS').length).toBeGreaterThanOrEqual(2);
  });

  it('only company accounts can sign in when ENABLED_PORTALS=company', async () => {
    const { phone } = await registerCustomer({ password: PASSWORD, confirmPassword: PASSWORD });
    const company = await registerCompany();
    const previous = env.ENABLED_PORTALS;
    (env as { ENABLED_PORTALS: string }).ENABLED_PORTALS = 'company';
    try {
      const denied = await api().post('/api/v1/auth/login').set(mobile).send({ identifier: phone, password: PASSWORD });
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('PORTAL_NOT_AVAILABLE');
      await api().post('/api/v1/auth/login').set(mobile).send({ identifier: company.phone, password: PASSWORD }).expect(200);
      const legacy = await api().post('/api/v1/auth/register/agency').send({});
      expect(legacy.status).toBe(404);
    } finally {
      (env as { ENABLED_PORTALS: string }).ENABLED_PORTALS = previous;
    }
  });

  it('blocks sign-in for suspended companies', async () => {
    const { phone, companyId } = await registerCompany();
    await prisma.company.update({ where: { id: companyId }, data: { status: 'SUSPENDED' } });
    const res = await api().post('/api/v1/auth/login').set(mobile).send({ identifier: phone, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COMPANY_SUSPENDED');
  });
});

describe('TEST 2/3 - profile, documents, saved locations', () => {
  it('updates profile with separate billing address and validates PAN against GSTIN', async () => {
    const { token, companyId } = await registerCompany();
    const c = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const base = {
      name: 'Test Lubricants Pvt Ltd',
      businessType: 'MANUFACTURER',
      industry: 'Lubricants',
      website: 'example.com',
      contactPersonName: 'Anita Kulkarni',
      contactPhone: '9822000000',
      contactEmail: 'ops@example.com',
      registeredAddress: { address: '14 Chakan MIDC', city: 'Pune', state: 'Maharashtra', pincode: '410501' },
      billingSameAsRegistered: false,
      billingAddress: { address: 'Tower B, Baner', city: 'Pune', state: 'Maharashtra', pincode: '411045' },
    };
    const wrongPan = await api().put('/api/v1/companies/profile').set(bearer(token)).send({ ...base, panNumber: uniquePan() });
    expect(wrongPan.status).toBe(400);
    const ok = await api().put('/api/v1/companies/profile').set(bearer(token)).send({ ...base, panNumber: c.gstNumber.slice(2, 12) }).expect(200);
    expect(ok.body.data.company.billingAddress.pincode).toBe('411045');
    expect(ok.body.data.company.website).toBe('https://example.com');
  });

  it('uploads and replaces documents (history kept), rejects disguised files', async () => {
    const { token, companyId } = await registerCompany();
    const pdf = Buffer.from('%PDF-1.4\n% test\n');
    await api().post('/api/v1/companies/documents').set(bearer(token)).field('type', 'GST_CERTIFICATE').attach('file', pdf, 'gst.pdf').expect(201);
    await api().post('/api/v1/companies/documents').set(bearer(token)).field('type', 'GST_CERTIFICATE').attach('file', pdf, 'gst-v2.pdf').expect(201);
    const all = await prisma.companyDocument.findMany({ where: { companyId, type: 'GST_CERTIFICATE' } });
    expect(all).toHaveLength(2);
    expect(all.filter((d) => d.isCurrent)).toHaveLength(1);
    const exe = await api().post('/api/v1/companies/documents').set(bearer(token)).field('type', 'PAN_CARD').attach('file', Buffer.from('MZ\x90\x00binary'), 'pan.pdf');
    expect(exe.status).toBe(400);
    expect(exe.body.error.code).toBe('FILE_REJECTED');
    const listed = await api().get('/api/v1/companies/documents').set(bearer(token)).expect(200);
    const dl = await api().get(`/api/v1/companies/documents/${listed.body.data.documents[0].id}/download`).set(bearer(token)).expect(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
  });

  it('manages saved locations with a single default pickup', async () => {
    const { token } = await registerCompany();
    const loc = (name: string) => ({ name, type: 'FACTORY', address: 'Chakan MIDC Phase II, Pune', latitude: 18.76, longitude: 73.86, city: 'Pune', state: 'Maharashtra', pincode: '410501', isDefaultPickup: true });
    const a = await api().post('/api/v1/locations').set(bearer(token)).send(loc('Plant A')).expect(201);
    await api().post('/api/v1/locations').set(bearer(token)).send(loc('Plant B')).expect(201);
    const list = await api().get('/api/v1/locations?q=plant').set(bearer(token)).expect(200);
    expect(list.body.data.locations.filter((l: { isDefaultPickup: boolean }) => l.isDefaultPickup)).toHaveLength(1);
    await api().delete(`/api/v1/locations/${a.body.data.location.id}`).set(bearer(token)).expect(200);
  });
});

describe('TEST 4-11 - booking, offers & negotiation', () => {
  it('computes route + freight server-side and enforces the offer range', async () => {
    const { token } = await registerCompany();
    const tooHigh = await createBooking(token, { customerOffer: 10_000_000 });
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body.error.code).toBe('OFFER_OUT_OF_RANGE');
    const res = await createBooking(token);
    expect(res.status).toBe(201);
    const b = res.body.data.booking;
    expect(b.bookingCode).toMatch(/^TLB\d{7}$/);
    expect(b.status).toBe('SEARCHING');
    expect(Number(b.distanceKm)).toBeGreaterThan(0);
    expect(b.routeProvider).toBe('fixture-test');
    expect(b.statusHistory[0].toStatus).toBe('SEARCHING');
  });

  it('runs a full negotiation and confirms exactly one transporter', async () => {
    const { token } = await registerCompany();
    const booking = (await createBooking(token)).body.data.booking;
    const sim = await api().post(`/api/v1/demo/bookings/${booking.id}/offers`).set(bearer(token)).send({ count: 3 }).expect(200);
    expect(sim.body.data.offers.length).toBe(3);
    expect(sim.body.data.offers.every((o: { isDemo: boolean }) => o.isDemo)).toBe(true);

    const offers = (await api().get(`/api/v1/bookings/${booking.id}/offers`).set(bearer(token)).expect(200)).body.data.offers;
    const target = [...offers].sort((a, b) => b.currentAmount - a.currentAmount)[0];
    expect((await api().get(`/api/v1/bookings/${booking.id}`).set(bearer(token))).body.data.booking.status).toBe('OFFERS_RECEIVED');

    // Counter must be below the current price.
    await api().post(`/api/v1/offers/${target.id}/counter`).set(bearer(token)).send({ amount: target.currentAmount + 10 }).expect(400);
    const countered = await api().post(`/api/v1/offers/${target.id}/counter`).set(bearer(token)).send({ amount: target.currentAmount - 300 }).expect(200);
    expect(countered.body.data.offer.status).toBe('COUNTERED');
    expect((await api().get(`/api/v1/bookings/${booking.id}`).set(bearer(token))).body.data.booking.status).toBe('NEGOTIATION');

    // Transporter counters again, company accepts.
    const again = await api().post(`/api/v1/demo/offers/${target.id}/respond`).set(bearer(token)).send({ action: 'COUNTER' }).expect(200);
    expect(again.body.data.offer.status).toBe('PENDING');
    expect(again.body.data.offer.history.length).toBe(3);

    const [r1, r2] = await Promise.all([
      api().post(`/api/v1/offers/${target.id}/accept`).set(bearer(token)),
      api().post(`/api/v1/offers/${offers.find((o: { id: string }) => o.id !== target.id).id}/accept`).set(bearer(token)),
    ]);
    // Concurrent accepts: exactly one wins (booking row lock + unique accepted-offer index).
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);

    const after = (await api().get(`/api/v1/bookings/${booking.id}`).set(bearer(token))).body.data.booking;
    expect(after.status).toBe('CONFIRMED');
    expect(after.allocations).toHaveLength(1);
    expect(after.trips).toHaveLength(1);
    expect(after.invoices).toHaveLength(1);
    const final = (await api().get(`/api/v1/bookings/${booking.id}/offers`).set(bearer(token))).body.data.offers;
    expect(final.filter((o: { status: string }) => o.status === 'ACCEPTED')).toHaveLength(1);
    expect(final.filter((o: { status: string }) => o.status === 'UNSUCCESSFUL')).toHaveLength(2);
  });

  it('expires stale offers and reopens the booking for search', async () => {
    const { token } = await registerCompany();
    const booking = (await createBooking(token)).body.data.booking;
    await api().post(`/api/v1/demo/bookings/${booking.id}/offers`).set(bearer(token)).send({ count: 1 }).expect(200);
    await prisma.transporterOffer.updateMany({ where: { bookingId: booking.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const offers = (await api().get(`/api/v1/bookings/${booking.id}/offers`).set(bearer(token))).body.data.offers;
    expect(offers[0].status).toBe('EXPIRED');
    expect((await api().get(`/api/v1/bookings/${booking.id}`).set(bearer(token))).body.data.booking.status).toBe('SEARCHING');
    await api().post(`/api/v1/offers/${offers[0].id}/accept`).set(bearer(token)).expect(409);
  });

  it('edits only eligible bookings, cancels with reason, and repeats', async () => {
    const { token } = await registerCompany();
    const booking = (await createBooking(token)).body.data.booking;
    const edited = await api().put(`/api/v1/bookings/${booking.id}`).set(bearer(token)).send({ version: booking.version, loadingTime: '11:30' }).expect(200);
    expect(edited.body.data.booking.loadingTime).toBe('11:30');
    // Stale version is rejected (optimistic concurrency).
    await api().put(`/api/v1/bookings/${booking.id}`).set(bearer(token)).send({ version: booking.version, loadingTime: '12:00' }).expect(409);
    const repeat = await api().post(`/api/v1/bookings/${booking.id}/repeat`).set(bearer(token)).expect(200);
    expect(repeat.body.data.template.pickup.city).toBe('Pune');
    await api().post(`/api/v1/bookings/${booking.id}/cancel`).set(bearer(token)).send({ reason: 'x' }).expect(400);
    const cancelled = await api().post(`/api/v1/bookings/${booking.id}/cancel`).set(bearer(token)).send({ reason: 'Plan changed' }).expect(200);
    expect(cancelled.body.data.booking.status).toBe('CANCELLED');
    await api().post(`/api/v1/bookings/${booking.id}/cancel`).set(bearer(token)).send({ reason: 'Plan changed' }).expect(409);
  });
});

describe('TEST 12-15 - trips, tracking, payments, documents', () => {
  async function confirmedBooking() {
    const { token } = await registerCompany();
    const booking = (await createBooking(token)).body.data.booking;
    const offers = (await api().post(`/api/v1/demo/bookings/${booking.id}/offers`).set(bearer(token)).send({ count: 1 })).body.data.offers;
    await api().post(`/api/v1/offers/${offers[0].id}/accept`).set(bearer(token)).expect(200);
    return { token, booking };
  }

  it('progresses a demo trip with SIMULATED tracking only', async () => {
    const { token, booking } = await confirmedBooking();
    const trip = (await api().get('/api/v1/trips?scope=active').set(bearer(token))).body.data.trips.find((t: { booking: { id: string } }) => t.booking.id === booking.id);
    for (let i = 0; i < 5; i++) await api().post(`/api/v1/demo/trips/${trip.id}/advance`).set(bearer(token)).expect(200);
    const t = (await api().get(`/api/v1/trips/${trip.id}/tracking`).set(bearer(token)).expect(200)).body.data.tracking;
    expect(t.status).toBe('IN_TRANSIT');
    expect(t.dataSource).toBe('SIMULATED');
    expect(t.dataSourceLabel).toMatch(/not live GPS/);
    expect(t.distanceTravelledKm).toBeGreaterThan(0);
    const pts = await prisma.tripTracking.findMany({ where: { tripId: trip.id } });
    expect(pts.every((p) => p.source === 'SIMULATED')).toBe(true);
  });

  it('pays the advance through verified gateway flow and never trusts the browser', async () => {
    const { token, booking } = await confirmedBooking();
    const breakdown = (await api().get(`/api/v1/bookings/${booking.id}/payment`).set(bearer(token)).expect(200)).body.data;
    expect(breakdown.breakdown.totalPayable).toBeGreaterThan(breakdown.breakdown.agreedFreight);
    const order = (await api().post('/api/v1/payments/create-order').set(bearer(token)).send({ bookingId: booking.id, purpose: 'ADVANCE' }).expect(201)).body.data.order;
    expect(order.amount).toBe(breakdown.breakdown.advanceAmount);

    // A signature for another order / forged values must fail.
    const forged = await api().post('/api/v1/payments/verify').set(bearer(token)).send({ orderId: order.orderId, paymentId: 'pay_fake_000', signature: 'f'.repeat(64) });
    expect(forged.status).toBe(400);
    expect((await prisma.payment.findUniqueOrThrow({ where: { providerOrderId: order.orderId } })).status).toBe('CREATED');

    const gw = (await api().post('/api/v1/payments/mock/checkout').set(bearer(token)).send({ orderId: order.orderId, outcome: 'success', method: 'upi' }).expect(200)).body.data;
    const paid = await api().post('/api/v1/payments/verify').set(bearer(token)).send({ orderId: order.orderId, paymentId: gw.paymentId, signature: gw.signature }).expect(200);
    expect(paid.body.data.payment.status).toBe('PAID');
    expect(paid.body.data.payment.receiptNumber).toMatch(/^RCP-\d{6}$/);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).paymentStatus).toBe('ADVANCE_PAID');
    // Financial rows cannot be deleted.
    await expect(prisma.payment.delete({ where: { id: paid.body.data.payment.id } })).rejects.toThrow();

    const receipt = await api().get(`/api/v1/payments/${paid.body.data.payment.id}/receipt.pdf`).set(bearer(token)).expect(200);
    expect(receipt.headers['content-type']).toBe('application/pdf');
    const docs = (await api().get(`/api/v1/documents?bookingId=${booking.id}`).set(bearer(token)).expect(200)).body.data.documents;
    expect(docs.map((d: { type: string }) => d.type).sort()).toEqual(['BOOKING_CONFIRMATION', 'FREIGHT_INVOICE', 'PAYMENT_RECEIPT']);
    for (const d of docs) await api().get(`/api/v1/documents/${encodeURIComponent(d.id)}`).set(bearer(token)).expect(200);
  });
});

describe('TEST 16-17 - support & tenant isolation', () => {
  it('raises a support ticket with attachments', async () => {
    const { token } = await registerCompany();
    const res = await api()
      .post('/api/v1/support/tickets')
      .set(bearer(token))
      .field('category', 'PAYMENT_PROBLEM')
      .field('subject', 'Refund not received')
      .field('description', 'Refund for the cancelled booking has not been received yet.')
      .attach('attachments', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), 'screenshot.png')
      .expect(201);
    expect(res.body.data.ticket.ticketNumber).toMatch(/^TKT\d{6}$/);
    expect(res.body.data.ticket.status).toBe('OPEN');
    const list = await api().get('/api/v1/support/tickets').set(bearer(token)).expect(200);
    expect(list.body.data.tickets).toHaveLength(1);
  });

  it("never exposes one company's bookings, offers, payments or documents to another", async () => {
    const a = await registerCompany();
    const b = await registerCompany();
    const booking = (await createBooking(a.token)).body.data.booking;
    const offers = (await api().post(`/api/v1/demo/bookings/${booking.id}/offers`).set(bearer(a.token)).send({ count: 1 })).body.data.offers;

    const asB = bearer(b.token);
    await api().get(`/api/v1/bookings/${booking.id}`).set(asB).expect(404);
    await api().get(`/api/v1/bookings/${booking.id}/offers`).set(asB).expect(404);
    await api().get(`/api/v1/bookings/${booking.id}/summary.pdf`).set(asB).expect(404);
    await api().post(`/api/v1/bookings/${booking.id}/cancel`).set(asB).send({ reason: 'malicious' }).expect(404);
    await api().post(`/api/v1/offers/${offers[0].id}/accept`).set(asB).expect(404);
    await api().post(`/api/v1/demo/bookings/${booking.id}/offers`).set(asB).send({ count: 1 }).expect(404);
    await api().get(`/api/v1/documents/BOOKING_SUMMARY:${booking.id}`).set(asB).expect(404);
    await api().post('/api/v1/payments/create-order').set(asB).send({ bookingId: booking.id, purpose: 'ADVANCE' }).expect(404);
    const listB = await api().get('/api/v1/bookings').set(asB).expect(200);
    expect(listB.body.data.items).toHaveLength(0);
    // Company A still sees its own booking.
    await api().get(`/api/v1/bookings/${booking.id}`).set(bearer(a.token)).expect(200);
  });

  it('non-company users cannot reach company endpoints', async () => {
    const { res } = await registerCustomer({ password: PASSWORD, confirmPassword: PASSWORD });
    const token = res.body.data.accessToken;
    const r = await api().get('/api/v1/bookings').set(bearer(token));
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('COMPANY_REQUIRED');
  });
});

describe('Phase 1 revision - verification, partial fulfilment, contacts, reports', () => {
  it('blocks commercial booking submission until the company is verified', async () => {
    const { token, companyId } = await registerCompany({ verified: false });
    const res = await createBooking(token);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COMPANY_NOT_ELIGIBLE');
    // Profile completion is still allowed while pending.
    await api().get('/api/v1/companies/profile').set(bearer(token)).expect(200);
    await prisma.company.update({ where: { id: companyId }, data: { status: 'VERIFIED' } });
    expect((await createBooking(token)).status).toBe(201);
  });

  it('allocates a multi-tanker booking across transporters (partial fulfilment, pro-rated price)', async () => {
    const { token } = await registerCompany();
    const booking = (await createBooking(token, { numberOfTankers: 3, quantityKl: 60 })).body.data.booking;
    const offers = (await api().post(`/api/v1/demo/bookings/${booking.id}/offers`).set(bearer(token)).send({ count: 3 }).expect(200)).body.data.offers;
    const partial = offers.find((o: { tankersAvailable: number }) => o.tankersAvailable === 2);
    const full = offers.find((o: { tankersAvailable: number }) => o.tankersAvailable === 3);
    expect(partial && full).toBeTruthy();

    const first = await api().post(`/api/v1/offers/${partial.id}/accept`).set(bearer(token)).expect(200);
    expect(first.body.data).toMatchObject({ tankersAllocated: 2, tankersRemaining: 1, confirmed: false });
    let b = (await api().get(`/api/v1/bookings/${booking.id}`).set(bearer(token))).body.data.booking;
    expect(b.status).toBe('NEGOTIATION');
    expect(b.tankersAllocated).toBe(2);
    // Same offer cannot be accepted twice.
    await api().post(`/api/v1/offers/${partial.id}/accept`).set(bearer(token)).expect(409);

    const second = await api().post(`/api/v1/offers/${full.id}/accept`).set(bearer(token)).expect(200);
    expect(second.body.data).toMatchObject({ tankersAllocated: 1, tankersRemaining: 0, confirmed: true });
    expect(second.body.data.amount).toBeCloseTo(full.currentAmount / 3, 0);
    b = (await api().get(`/api/v1/bookings/${booking.id}`).set(bearer(token))).body.data.booking;
    expect(b.status).toBe('CONFIRMED');
    expect(b.allocations).toHaveLength(2);
    expect(b.trips).toHaveLength(3);
    expect(b.invoices).toHaveLength(2);
    expect(b.acceptedFreight).toBeCloseTo(b.allocations.reduce((s: number, a: { agreedFreight: number }) => s + a.agreedFreight, 0), 2);
    const final = (await api().get(`/api/v1/bookings/${booking.id}/offers`).set(bearer(token))).body.data.offers;
    expect(final.filter((o: { status: string }) => o.status === 'UNSUCCESSFUL')).toHaveLength(1);
    const pay = (await api().get(`/api/v1/bookings/${booking.id}/payment`).set(bearer(token))).body.data;
    expect(pay.invoices).toHaveLength(2);
    expect(pay.breakdown.agreedFreight).toBeCloseTo(b.acceptedFreight, 2);
  });

  it('manages authorized contacts (primary contact protected)', async () => {
    const { token } = await registerCompany();
    const c = await api().post('/api/v1/companies/contacts').set(bearer(token)).send({ name: 'Ravi Kale', designation: 'Logistics Manager', department: 'Supply chain', phone: '9822001100', email: 'ravi@example.com' }).expect(201);
    await api().put(`/api/v1/companies/contacts/${c.body.data.contact.id}`).set(bearer(token)).send({ name: 'Ravi Kale', department: 'Operations', phone: '9822001100' }).expect(200);
    const list = (await api().get('/api/v1/companies/contacts').set(bearer(token)).expect(200)).body.data.contacts;
    expect(list).toHaveLength(2);
    const primary = list.find((x: { isPrimary: boolean }) => x.isPrimary);
    await api().delete(`/api/v1/companies/contacts/${primary.id}`).set(bearer(token)).expect(400);
    await api().delete(`/api/v1/companies/contacts/${c.body.data.contact.id}`).set(bearer(token)).expect(200);
  });

  it('generates all 13 reports from live records and exports Excel and PDF', async () => {
    const { token } = await registerCompany();
    const booking = (await createBooking(token)).body.data.booking;
    const offers = (await api().post(`/api/v1/demo/bookings/${booking.id}/offers`).set(bearer(token)).send({ count: 1 })).body.data.offers;
    await api().post(`/api/v1/offers/${offers[0].id}/accept`).set(bearer(token)).expect(200);
    const list = (await api().get('/api/v1/reports').set(bearer(token)).expect(200)).body.data.reports;
    expect(list).toHaveLength(13);
    for (const r of list) {
      const res = await api().get(`/api/v1/reports/${r.key}`).set(bearer(token)).expect(200);
      expect(res.body.data.report.columns.length).toBeGreaterThan(0);
      expect(res.body.data.report.summary.length).toBeGreaterThan(0);
    }
    const total = (await api().get('/api/v1/reports/total-bookings').set(bearer(token))).body.data.report;
    expect(total.summary[0].value).toBe(1);
    const cmp = (await api().get('/api/v1/reports/freight-comparison').set(bearer(token))).body.data.report;
    expect(cmp.rows[0].accepted).toBe(offers[0].currentAmount);
    const xlsx = await api().get('/api/v1/reports/total-bookings/export?format=xlsx').set(bearer(token)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const pdf = await api().get('/api/v1/reports/monthly-expenditure/export?format=pdf').set(bearer(token)).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    await api().get('/api/v1/reports/total-bookings?from=2026-12-01&to=2026-01-01').set(bearer(token)).expect(400);
  });
});
