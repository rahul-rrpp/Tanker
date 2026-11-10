/**
 * End-to-end journey test of the Company Portal API against a running backend (spec section 21).
 *   node scripts/smoke-company-api.mjs [baseUrl]
 * Requires: DEMO_MODE=true, PAYMENT_PROVIDER=mock, OTP_PROVIDER=mock + OTP_DEV_ECHO=true, demo data seeded.
 * Uses the mobile token transport (Authorization: Bearer) so no cookie/CSRF handling is needed.
 */
const BASE = (process.argv[2] ?? 'http://localhost:4000') + '/api/v1';
const results = [];
let token = '';

async function call(method, path, body, opts = {}) {
  const t = opts.token ?? token;
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), 'X-Client-Type': 'mobile', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, type };
}
function check(name, cond, detail = '') {
  results.push({ name, ok: Boolean(cond) });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

// GSTIN with a valid check digit (state 27 = Maharashtra).
const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function gstin(pan) {
  const f = `27${pan}1Z`;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CH.indexOf(f[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return f + CH[(36 - (sum % 36)) % 36];
}
const rnd = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const letters = (n) => Array.from({ length: n }, () => L[Math.floor(Math.random() * L.length)]).join('');

// 1-3. Registration, mobile + email verification, login --------------------------------
const phone = `98${rnd(8)}`;
const email = `smoke.${Date.now()}@example.com`;
async function verify(channel, destination) {
  const s = await call('POST', '/auth/send-otp', { channel, destination, purpose: 'REGISTRATION' });
  const v = await call('POST', '/auth/verify-otp', { channel, destination, purpose: 'REGISTRATION', code: s.data.data.devCode });
  return v.data.data?.verificationToken;
}
const phoneToken = await verify('SMS', phone);
const emailToken = await verify('EMAIL', email);
check('1-2. Mobile and email OTP verified', phoneToken && emailToken);
const reg = await call('POST', '/auth/register', {
  companyName: 'Smoke Test Oils Pvt Ltd', contactPersonName: 'Smoke Tester', phone, email, password: 'Smoke@1234', confirmPassword: 'Smoke@1234',
  gstNumber: gstin(`${letters(5)}${rnd(4)}${letters(1)}`), businessType: 'TRADER', state: 'Maharashtra', city: 'Pune', address: '1 Test Road, Hadapsar', pincode: '411028',
  acceptTerms: true, phoneVerificationToken: phoneToken, emailVerificationToken: emailToken,
});
check('1. Company registered with company ID', reg.status === 201 && /^CMP\d{6}$/.test(reg.data.data.company.companyCode), reg.data.data?.company?.companyCode);
const login = await call('POST', '/auth/login', { identifier: email, password: 'Smoke@1234' }, { token: '' });
token = login.data.data?.accessToken;
check('3. Login with email + password', login.status === 200 && token);

// 4-5. Profile completion and documents ------------------------------------------------------
const prof = (await call('GET', '/companies/profile')).data.data.company;
const upd = await call('PUT', '/companies/profile', {
  name: prof.name, panNumber: prof.gstNumber.slice(2, 12), businessType: 'TRADER', industry: 'Fuel trading', website: 'example.com',
  contactPersonName: 'Smoke Tester', contactPhone: phone, contactEmail: email,
  registeredAddress: { address: '1 Test Road, Hadapsar', city: 'Pune', state: 'Maharashtra', pincode: '411028' }, billingSameAsRegistered: true,
});
check('4. Profile completed', upd.status === 200);
const contact = await call('POST', '/companies/contacts', { name: 'Dispatch Desk', designation: 'Dispatcher', department: 'Logistics', phone: '9822112233' });
check('4. Authorized contact added', contact.status === 201);
for (const type of ['GST_CERTIFICATE', 'PAN_CARD']) {
  const fd = new FormData();
  fd.append('type', type);
  fd.append('file', new Blob([Buffer.from('%PDF-1.4\n%smoke\n')], { type: 'application/pdf' }), `${type}.pdf`);
  const up = await call('POST', '/companies/documents', fd);
  check(`5. Document uploaded (${type})`, up.status === 201);
}

// Verification gate (spec 3.3)
const lub = (await call('GET', '/catalog')).data.data.products.find((p) => p.code === 'LUBRICATING_OIL');
const pickup = { address: 'Chakan MIDC, Pune', latitude: 18.7606, longitude: 73.8636, city: 'Pune', state: 'Maharashtra', pincode: '410501' };
const delivery = { address: 'Hazira Industrial Area, Surat', latitude: 21.1137, longitude: 72.638, city: 'Surat', state: 'Gujarat', pincode: '394270' };
const day = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const bookingBody = (offer, extra = {}) => ({
  pickup, delivery, routeIndex: 0, productId: lub.id, tankerCapacityKl: 20, quantityKl: 19.5, numberOfTankers: 1, compartmentRequirement: 'ANY', productCompatibility: 'ANY_COMPATIBLE',
  loadingDate: day(3), loadingTime: '09:00', loadingContactName: 'Ravi Kale', loadingContactPhone: '9822001100', expectedDeliveryDate: day(4),
  deliveryContactName: 'Mehul Shah', deliveryContactPhone: '9825001100', customerOffer: offer, ...extra,
});
const blocked = await call('POST', '/bookings', bookingBody(20000));
check('Unverified company cannot submit a booking', blocked.status === 403 && blocked.data.error.code === 'COMPANY_NOT_ELIGIBLE');
const ver = await call('POST', '/demo/company/verify');
check('Admin verification (demo stand-in)', ver.status === 200);

// 6. Saved locations ---------------------------------------------------------------------
const loc = await call('POST', '/locations', { name: 'Chakan Plant', type: 'FACTORY', address: pickup.address, latitude: pickup.latitude, longitude: pickup.longitude, city: 'Pune', state: 'Maharashtra', pincode: '410501', isDefaultPickup: true });
check('6. Saved location created', loc.status === 201);

// 7-10. Pickup/delivery, route, requirements, freight ----------------------------------------------
const places = await call('GET', '/maps/places?q=Hazira%20Surat');
check('7. Places search', places.status === 200 && places.data.data.suggestions.length > 0, places.data.data?.suggestions?.[0]?.primaryText);
const quote = await call('POST', '/bookings/quote', { pickup, delivery, productId: lub.id, tankerCapacityKl: 20, numberOfTankers: 1 });
const q = quote.data.data;
check('8. Road route (distance, time, alternatives)', quote.status === 200 && q.selectedRoute.distanceKm > 300, `${q?.selectedRoute?.distanceKm} km, ${q?.selectedRoute?.durationMinutes} min, ${q?.routes?.length} route(s) via ${q?.provider}`);
check('9-10. Tanker requirement + indicative freight', q.estimate.suggestedFreight > 0, `${q.estimate.ruleName}: Rs ${q.estimate.suggestedFreight}`);

// 11-12. Customer offer and booking -----------------------------------------------------------
const offerAmount = Math.round(q.estimate.suggestedFreight * 0.95);
const created = await call('POST', `/bookings?repeatOf=`, bookingBody(offerAmount, { pickup: { ...pickup, savedLocationId: loc.data.data.location.id } }));
const booking = created.data.data?.booking;
check('11-12. Booking created (SEARCHING)', created.status === 201 && booking.status === 'SEARCHING', booking?.bookingCode);

// 13-16. Offers, counter, demo transporter acceptance, confirmation -----------------------------------
const sim = await call('POST', `/demo/bookings/${booking.id}/offers`, { count: 3 });
check('13. Multiple demo transporter offers', sim.data.data?.offers?.length >= 2, `${sim.data.data?.offers?.length} offers`);
let offers = (await call('GET', `/bookings/${booking.id}/offers`)).data.data.offers;
const target = [...offers].sort((a, b) => b.currentAmount - a.currentAmount)[0];
const counter = await call('POST', `/offers/${target.id}/counter`, { amount: target.currentAmount - 500 });
check('14. Customer counter-offer', counter.status === 200 && counter.data.data.offer.status === 'COUNTERED');
const tAccept = await call('POST', `/demo/offers/${target.id}/respond`, { action: 'ACCEPT' });
check('15. Transporter accepts counter (demo)', tAccept.status === 200 && tAccept.data.data.offer.status === 'PENDING');
const accept = await call('POST', `/offers/${target.id}/accept`);
check('16. Booking confirmed', accept.status === 200 && accept.data.data.confirmed === true);
const dup = await call('POST', `/offers/${offers.find((o) => o.id !== target.id).id}/accept`);
check('Duplicate acceptance prevented', dup.status === 409);

// Partial fulfilment (multi-tanker)
const q3 = (await call('POST', '/bookings/quote', { pickup, delivery, productId: lub.id, tankerCapacityKl: 20, numberOfTankers: 3 })).data.data;
const multi = (await call('POST', '/bookings', bookingBody(Math.round(q3.estimate.suggestedFreight * 0.97), { numberOfTankers: 3, quantityKl: 60 }))).data.data.booking;
const mOffers = (await call('POST', `/demo/bookings/${multi.id}/offers`, { count: 3 })).data.data.offers;
const part = mOffers.find((o) => o.tankersAvailable === 2);
const rest = mOffers.find((o) => o.tankersAvailable === 3);
const a1 = await call('POST', `/offers/${part.id}/accept`);
const a2 = await call('POST', `/offers/${rest.id}/accept`);
const mDetail = (await call('GET', `/bookings/${multi.id}`)).data.data.booking;
check('Partial fulfilment across transporters', a1.data.data?.tankersRemaining === 1 && a2.data.data?.confirmed && mDetail.allocations.length === 2 && mDetail.trips.length === 3, `${mDetail.allocations.length} allocations, ${mDetail.trips.length} trips`);

// 17-18. Vehicle/driver assignment and tracking ------------------------------------------------
const trip = (await call('GET', '/trips?scope=active')).data.data.trips.find((t) => t.booking.id === booking.id);
await call('POST', `/demo/trips/${trip.id}/advance`);
await call('POST', `/demo/trips/${trip.id}/advance`);
const assigned = (await call('GET', `/trips/${trip.id}`)).data.data.trip;
check('17. Vehicle and driver assigned', assigned.tanker?.registrationNumber && assigned.driver?.user?.fullName, `${assigned.tanker?.registrationNumber} / ${assigned.driver?.user?.fullName}`);
for (let i = 0; i < 3; i++) await call('POST', `/demo/trips/${trip.id}/advance`);
const tracking = (await call('GET', `/trips/${trip.id}/tracking`)).data.data.tracking;
check('18. Tracking demo (labelled SIMULATED)', tracking.dataSource === 'SIMULATED' && tracking.distanceTravelledKm > 0 && tracking.remainingDistanceKm > 0, `${tracking.distanceTravelledKm} km done, ${tracking.remainingDistanceKm} km left`);

// 19-20. Payment and invoice ---------------------------------------------------------------------
const order = (await call('POST', '/payments/create-order', { bookingId: booking.id, purpose: 'ADVANCE' })).data.data.order;
const forged = await call('POST', '/payments/verify', { orderId: order.orderId, paymentId: 'pay_forged_123', signature: 'a'.repeat(64) });
check('Forged payment signature rejected', forged.status === 400);
const gw = (await call('POST', '/payments/mock/checkout', { orderId: order.orderId, outcome: 'success', method: 'credit_card' })).data.data;
const paid = await call('POST', '/payments/verify', { orderId: order.orderId, paymentId: gw.paymentId, signature: gw.signature });
check('19. Payment verified server-side', paid.status === 200 && paid.data.data.payment.status === 'PAID' && paid.data.data.payment.method === 'CREDIT_CARD', paid.data.data?.payment?.receiptNumber);
const docs = (await call('GET', `/documents?bookingId=${booking.id}`)).data.data.documents;
const inv = docs.find((d) => d.type === 'FREIGHT_INVOICE');
const invPdf = await call('GET', `/documents/${encodeURIComponent(inv.id)}`);
check('20. Invoice download (PDF)', invPdf.status === 200 && invPdf.data.subarray(0, 4).toString() === '%PDF');
const receipt = await call('GET', `/payments/${paid.data.data.payment.id}/receipt.pdf`);
check('20. Receipt download (PDF)', receipt.status === 200 && receipt.data.subarray(0, 4).toString() === '%PDF');

// 21. Support ticket -------------------------------------------------------------------------------
const fd = new FormData();
fd.append('category', 'VEHICLE_DELAY');
fd.append('bookingId', booking.id);
fd.append('subject', 'Tanker running late');
fd.append('description', 'The tanker has not reached the loading point at the agreed time.');
fd.append('attachments', new Blob([Buffer.from('%PDF-1.4\n%x\n')], { type: 'application/pdf' }), 'note.pdf');
const ticket = await call('POST', '/support/tickets', fd);
check('21. Support ticket with attachment', ticket.status === 201 && ticket.data.data.ticket.attachments.length === 1, ticket.data.data?.ticket?.ticketNumber);

// 22. Booking history and reports ------------------------------------------------------------------
const hist = (await call('GET', '/bookings?tab=all')).data.data;
check('22. Booking history', hist.total === 2, `${hist.total} bookings`);
const reports = (await call('GET', '/reports')).data.data.reports;
let allOk = true;
for (const r of reports) {
  const res = await call('GET', `/reports/${r.key}`);
  if (res.status !== 200) allOk = false;
}
check('22. All 13 reports generated from live records', reports.length === 13 && allOk);
const total = (await call('GET', '/reports/total-bookings')).data.data.report;
check('22. Report figures match database', total.summary[0].value === 2);
const xlsx = await call('GET', '/reports/freight-comparison/export?format=xlsx');
const pdf = await call('GET', '/reports/monthly-expenditure/export?format=pdf');
check('22. Excel + PDF export', xlsx.status === 200 && xlsx.data.subarray(0, 2).toString() === 'PK' && pdf.data.subarray(0, 4).toString() === '%PDF');

// Company-level data isolation -----------------------------------------------------------------------
const other = (await call('POST', '/auth/login', { identifier: '9100000002', password: 'Demo@12345' }, { token: '' })).data.data.accessToken;
const iso = await Promise.all([
  call('GET', `/bookings/${booking.id}`, null, { token: other }),
  call('GET', `/bookings/${booking.id}/offers`, null, { token: other }),
  call('GET', `/trips/${trip.id}/tracking`, null, { token: other }),
  call('GET', `/payments/${paid.data.data.payment.id}`, null, { token: other }),
  call('GET', `/documents/${encodeURIComponent(inv.id)}`, null, { token: other }),
  call('POST', `/offers/${target.id}/reject`, {}, { token: other }),
  call('GET', `/support/tickets/${ticket.data.data.ticket.id}`, null, { token: other }),
]);
const otherTotal = (await call('GET', '/reports/total-bookings', null, { token: other })).data.data.report.rows.some((r) => r.bookingId === booking.id);
check('Data isolation: other company gets 404 and never sees these records in reports', iso.every((r) => r.status === 404) && !otherTotal, iso.map((r) => r.status).join(','));

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
