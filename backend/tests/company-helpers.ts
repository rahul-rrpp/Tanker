import { randomInt } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { getMockOtp } from '../src/modules/otp/providers/mock.provider';
import { buildGstin } from '../src/utils/gst';
import { api, bearer, mobile, PASSWORD, phoneVerificationToken, uniqueEmail, uniqueLicence, uniquePan, uniquePhone } from './helpers';

export async function emailVerificationToken(email: string): Promise<string> {
  await api().post('/api/v1/auth/otp/send').send({ channel: 'EMAIL', destination: email, purpose: 'REGISTRATION' }).expect(200);
  const res = await api()
    .post('/api/v1/auth/otp/verify')
    .send({ channel: 'EMAIL', destination: email, purpose: 'REGISTRATION', code: getMockOtp(email)! })
    .expect(200);
  return res.body.data.verificationToken;
}

export function companyBody(overrides: Record<string, unknown> = {}) {
  return {
    companyName: 'Test Lubricants Pvt Ltd',
    contactPersonName: 'Anita Kulkarni',
    password: PASSWORD,
    confirmPassword: PASSWORD,
    gstNumber: buildGstin('27', uniquePan()),
    businessType: 'MANUFACTURER',
    state: 'Maharashtra',
    city: 'Pune',
    address: '14 Chakan MIDC Phase II',
    pincode: '410501',
    acceptTerms: true,
    ...overrides,
  };
}

/** Registers a company through the public API (mobile + email OTP) and returns its admin token. */
export async function registerCompany(overrides: Record<string, unknown> = {}) {
  const phone = (overrides.phone as string) ?? uniquePhone();
  const email = (overrides.email as string) ?? uniqueEmail('company');
  const [phoneVerificationTokenValue, emailToken] = [await phoneVerificationToken(phone), await emailVerificationToken(email)];
  const res = await api()
    .post('/api/v1/auth/register')
    .set(mobile)
    .send(companyBody({ phone, email, phoneVerificationToken: phoneVerificationTokenValue, emailVerificationToken: emailToken, ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'verified')) }));
  const companyId = res.body?.data?.user?.company?.id as string;
  // Commercial bookings require a verified company; tests stand in for the future admin approval.
  if (companyId && overrides.verified !== false) await prisma.company.update({ where: { id: companyId }, data: { status: 'VERIFIED', verifiedAt: new Date() } });
  return { res, phone, email, token: res.body?.data?.accessToken as string, companyId };
}

/** Creates an approved demo transporter with a compatible tanker (stands in for the future Transporter Portal). */
export async function createDemoTransporter(productCode = 'LUBRICATING_OIL', capacityKl = 20) {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'AGENCY_OWNER' } });
  const product = await prisma.product.findUniqueOrThrow({ where: { code: productCode } });
  const type = await prisma.tankerType.findUniqueOrThrow({ where: { code: 'SS_TANKER' } });
  const owner = await prisma.user.create({ data: { fullName: 'Demo Owner', phone: uniquePhone(), accountStatus: 'ACTIVE', isPhoneVerified: true, roles: { create: { roleId: role.id } } } });
  const driverRole = await prisma.role.findUniqueOrThrow({ where: { name: 'DRIVER' } });
  const pan = uniquePan();
  const agency = await prisma.agency.create({
    data: {
      companyName: `Demo Carrier ${randomInt(1e6)}`,
      ownerId: owner.id,
      panNumber: pan,
      gstNumber: buildGstin('27', pan),
      address: 'Test yard',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
      verificationStatus: 'APPROVED',
      termsAcceptedAt: new Date(),
      isDemo: true,
      rating: 4.5,
      tankers: {
        create: {
          registrationNumber: `MH12TT${randomInt(1000, 9999)}${randomInt(10, 99)}`,
          capacityKl,
          tankerTypeId: type.id,
          isDemo: true,
          products: { create: { productId: product.id } },
        },
      },
    },
  });
  const driverUser = await prisma.user.create({ data: { fullName: 'Demo Driver', phone: uniquePhone(), accountStatus: 'ACTIVE', isPhoneVerified: true, roles: { create: { roleId: driverRole.id } } } });
  await prisma.driver.create({
    data: { userId: driverUser.id, agencyId: agency.id, licenceNumber: uniqueLicence(), licenceType: 'HGMV', licenceExpiry: new Date(Date.now() + 365 * 86400_000), verificationStatus: 'APPROVED', isDemo: true },
  });
  return agency;
}

export const PICKUP = { address: 'Chakan MIDC Phase II, Pune', latitude: 18.7606, longitude: 73.8636, city: 'Pune', state: 'Maharashtra', pincode: '410501' };
export const DELIVERY = { address: 'Mahul Road, Chembur, Mumbai', latitude: 19.0176, longitude: 72.8996, city: 'Mumbai', state: 'Maharashtra', pincode: '400074' };

const inDays = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);

export async function bookingBody(token: string, overrides: Record<string, unknown> = {}) {
  const product = await prisma.product.findUniqueOrThrow({ where: { code: 'LUBRICATING_OIL' } });
  const quote = await api()
    .post('/api/v1/bookings/quote')
    .set(bearer(token))
    .send({ pickup: PICKUP, delivery: DELIVERY, productId: product.id, tankerCapacityKl: 20, numberOfTankers: (overrides.numberOfTankers as number) ?? 1 })
    .expect(200);
  return {
    body: {
      pickup: PICKUP,
      delivery: DELIVERY,
      routeIndex: 0,
      productId: product.id,
      tankerCapacityKl: 20,
      quantityKl: 20,
      numberOfTankers: 1,
      loadingDate: inDays(2),
      loadingTime: '09:00',
      loadingContactName: 'Ravi Kale',
      loadingContactPhone: '9822001100',
      expectedDeliveryDate: inDays(3),
      deliveryContactName: 'Mehul Shah',
      deliveryContactPhone: '9825001100',
      customerOffer: Math.round(quote.body.data.estimate.suggestedFreight * 0.95),
      ...overrides,
    },
    quote: quote.body.data,
  };
}

export async function createBooking(token: string, overrides: Record<string, unknown> = {}) {
  const { body } = await bookingBody(token, overrides);
  const res = await api().post('/api/v1/bookings').set(bearer(token)).send(body);
  return res;
}
