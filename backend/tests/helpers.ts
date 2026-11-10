import { randomInt } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { getMockOtp } from '../src/modules/otp/providers/mock.provider';
import { hashPassword } from '../src/modules/auth/password.service';

export const app = createApp();
export const api = () => request(app);
export const PASSWORD = 'Str0ngPass!';

export function uniquePhone(): string {
  return `9${String(randomInt(0, 1e9)).padStart(9, '0')}`;
}
export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}.${Date.now()}.${randomInt(0, 1e6)}@example.com`;
}
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const randLetters = (n: number) => Array.from({ length: n }, () => LETTERS[randomInt(0, LETTERS.length)]).join('');
export function uniquePan(): string {
  return `${randLetters(5)}${String(randomInt(0, 1e4)).padStart(4, '0')}${randLetters(1)}`;
}
export function uniqueLicence(): string {
  return `MH14${2015 + randomInt(0, 10)}${String(randomInt(0, 1e7)).padStart(7, '0')}`;
}

export const mobile = { 'X-Client-Type': 'mobile' };

/** Sends + verifies a registration OTP and returns the verification token. */
export async function phoneVerificationToken(phone: string): Promise<string> {
  await api().post('/api/v1/auth/otp/send').send({ channel: 'SMS', destination: phone, purpose: 'REGISTRATION' }).expect(200);
  const code = getMockOtp(phone)!;
  const res = await api()
    .post('/api/v1/auth/otp/verify')
    .send({ channel: 'SMS', destination: phone, purpose: 'REGISTRATION', code })
    .expect(200);
  return res.body.data.verificationToken;
}

export async function registerCustomer(overrides: Record<string, unknown> = {}) {
  const phone = (overrides.phone as string) ?? uniquePhone();
  const token = await phoneVerificationToken(phone);
  const res = await api()
    .post('/api/v1/auth/register/customer')
    .set(mobile)
    .send({
      fullName: 'Priya Sharma',
      phone,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      customerType: 'INDIVIDUAL',
      city: 'Pune',
      state: 'Maharashtra',
      phoneVerificationToken: token,
      ...overrides,
    });
  return { res, phone };
}

export async function registerAgency(overrides: Record<string, unknown> = {}) {
  const phone = (overrides.phone as string) ?? uniquePhone();
  const email = (overrides.email as string) ?? uniqueEmail('owner');
  const token = await phoneVerificationToken(phone);
  const res = await api()
    .post('/api/v1/auth/register/agency')
    .set(mobile)
    .send({
      companyName: 'Jal Tankers Pvt Ltd',
      ownerName: 'Ramesh Patil',
      phone,
      email,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      panNumber: uniquePan(),
      address: '12 MIDC Road, Bhosari',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411026',
      acceptTerms: true,
      phoneVerificationToken: token,
      ...overrides,
    });
  return { res, phone, email };
}

export async function createSuperAdmin() {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
  const phone = uniquePhone();
  const email = uniqueEmail('admin');
  await prisma.user.create({
    data: {
      fullName: 'Platform Admin',
      phone,
      email,
      passwordHash: await hashPassword(PASSWORD),
      isPhoneVerified: true,
      accountStatus: 'ACTIVE',
      roles: { create: { roleId: role.id } },
    },
  });
  const res = await api().post('/api/v1/auth/login').set(mobile).send({ identifier: email, password: PASSWORD }).expect(200);
  return { token: res.body.data.accessToken as string, email };
}

/** Registers an agency, approves it as Super Admin and returns the owner's access token. */
export async function approvedAgency() {
  const { res, phone } = await registerAgency();
  const agencyId = res.body.data.user.agency.id as string;
  const admin = await createSuperAdmin();
  await api()
    .patch(`/api/v1/admin/agencies/${agencyId}/verification`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ status: 'APPROVED' })
    .expect(200);
  const login = await api().post('/api/v1/auth/login').set(mobile).send({ identifier: phone, password: PASSWORD }).expect(200);
  return { agencyId, ownerToken: login.body.data.accessToken as string, ownerPhone: phone, adminToken: admin.token };
}

export async function createInvitation(ownerToken: string, maxUses = 1) {
  const res = await api()
    .post('/api/v1/agency/invitations')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ maxUses })
    .expect(201);
  return res.body.data.invitation.code as string;
}

export async function registerDriver(invitationCode: string, overrides: Record<string, unknown> = {}) {
  const phone = (overrides.phone as string) ?? uniquePhone();
  const token = await phoneVerificationToken(phone);
  const res = await api()
    .post('/api/v1/auth/register/driver')
    .set(mobile)
    .send({
      fullName: 'Suresh Yadav',
      phone,
      invitationCode,
      licenceNumber: uniqueLicence(),
      licenceType: 'HGMV',
      licenceExpiry: new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10),
      phoneVerificationToken: token,
      ...overrides,
    });
  return { res, phone };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
