import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import {
  api,
  approvedAgency,
  createInvitation,
  mobile,
  PASSWORD,
  phoneVerificationToken,
  registerAgency,
  registerCustomer,
  registerDriver,
  uniqueEmail,
  uniquePhone,
} from './helpers';

describe('Agency registration', () => {
  it('creates user, agency, owner role and membership with PENDING_VERIFICATION', async () => {
    const { res, phone } = await registerAgency({ gstNumber: '' });
    expect(res.status).toBe(201);
    const { user, redirectTo, accessToken, refreshToken } = res.body.data;
    expect(user.roles).toEqual(['AGENCY_OWNER']);
    expect(user.agency.verificationStatus).toBe('PENDING_VERIFICATION');
    expect(user.agency.memberRole).toBe('AGENCY_OWNER');
    expect(redirectTo).toBe('/pending-verification');
    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|otpHash|tokenHash/);

    const db = await prisma.user.findUniqueOrThrow({ where: { phone }, include: { ownedAgency: true, memberships: true } });
    expect(db.isPhoneVerified).toBe(true);
    expect(db.passwordHash).not.toContain(PASSWORD);
    expect(db.ownedAgency?.verificationStatus).toBe('PENDING_VERIFICATION');
    expect(db.memberships).toHaveLength(1);
  });

  it('requires accepting terms and a phone verification', async () => {
    const res = await api().post('/api/v1/auth/register/agency').send({
      companyName: 'X Co', ownerName: 'A B', phone: uniquePhone(), email: uniqueEmail(), password: PASSWORD, confirmPassword: PASSWORD,
      panNumber: 'ABCDE1234F', address: 'Somewhere 1', city: 'Pune', state: 'MH', pincode: '411001', acceptTerms: false,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['acceptTerms', 'phoneVerificationToken']));
  });

  it('rejects mismatching passwords and a GSTIN that does not match the PAN', async () => {
    const { res } = await registerAgency({ confirmPassword: 'Different1', panNumber: 'ABCDE1234F', gstNumber: '27ZZZZZ9999Z1Z5' });
    expect(res.status).toBe(400);
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['confirmPassword', 'gstNumber']));
  });

  it('pending agency owner can see registration status but not restricted operations', async () => {
    const { res } = await registerAgency();
    const token = res.body.data.accessToken;
    const status = await api().get('/api/v1/agency/registration-status').set('Authorization', `Bearer ${token}`);
    expect(status.status).toBe(200);
    expect(status.body.data.agency.verificationStatus).toBe('PENDING_VERIFICATION');

    const invite = await api().post('/api/v1/agency/invitations').set('Authorization', `Bearer ${token}`).send({});
    expect(invite.status).toBe(403);
    expect(invite.body.error.code).toBe('AGENCY_NOT_APPROVED');
  });
});

describe('Customer registration', () => {
  it('creates an ACTIVE customer with CUSTOMER role', async () => {
    const { res } = await registerCustomer();
    expect(res.status).toBe(201);
    expect(res.body.data.user.roles).toEqual(['CUSTOMER']);
    expect(res.body.data.user.accountStatus).toBe('ACTIVE');
    expect(res.body.data.redirectTo).toBe('/customer/dashboard');
  });

  it('requires business name for business customers', async () => {
    const { res } = await registerCustomer({ customerType: 'BUSINESS' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('businessName');
  });

  it('allows OTP-only customers (no password)', async () => {
    const { res } = await registerCustomer({ password: undefined, confirmPassword: undefined });
    expect(res.status).toBe(201);
  });

  it('rejects a duplicate phone number', async () => {
    const { phone } = await registerCustomer();
    // Sending a registration OTP to an existing number is refused up-front…
    const otp = await api().post('/api/v1/auth/otp/send').send({ channel: 'SMS', destination: phone, purpose: 'REGISTRATION' });
    expect(otp.status).toBe(409);
    expect(otp.body.error.code).toBe('PHONE_ALREADY_REGISTERED');
  });

  it('rejects a duplicate email', async () => {
    const email = uniqueEmail();
    expect((await registerCustomer({ email })).res.status).toBe(201);
    const { res } = await registerCustomer({ email });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('rejects registration without a valid verification token, and token reuse', async () => {
    const phone = uniquePhone();
    const bad = await registerCustomer({ phone: uniquePhone(), phoneVerificationToken: 'not-a-real-token-xyz' });
    expect(bad.res.status).toBe(400);

    const token = await phoneVerificationToken(phone);
    // A token issued for one number cannot be used for another.
    const mismatch = await registerCustomer({ phone: uniquePhone(), phoneVerificationToken: token });
    expect(mismatch.res.body.error.code).toBe('INVALID_VERIFICATION_TOKEN');

    const body = { fullName: 'Ana Das', phone, customerType: 'INDIVIDUAL', city: 'Pune', state: 'MH', phoneVerificationToken: token };
    expect((await api().post('/api/v1/auth/register/customer').send(body)).status).toBe(201);
    // Re-using the same verification (even after deleting the user) fails.
    await prisma.user.delete({ where: { phone } });
    const reuse = await api().post('/api/v1/auth/register/customer').send(body);
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe('INVALID_VERIFICATION_TOKEN');
  });
});

describe('Driver registration', () => {
  it('links the driver to the inviting agency with PENDING_VERIFICATION', async () => {
    const { ownerToken, agencyId } = await approvedAgency();
    const code = await createInvitation(ownerToken);
    const { res } = await registerDriver(code.toLowerCase().replace('-', ''));
    expect(res.status).toBe(201);
    expect(res.body.data.user.roles).toEqual(['DRIVER']);
    expect(res.body.data.user.agency.id).toBe(agencyId);
    expect(res.body.data.user.driverVerificationStatus).toBe('PENDING_VERIFICATION');
    expect(res.body.data.redirectTo).toBe('/pending-verification');
  });

  it('rejects an invalid invitation code', async () => {
    const { res } = await registerDriver('ZZZZ-ZZZZ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INVITATION');
  });

  it('single-use invitation cannot be reused', async () => {
    const { ownerToken } = await approvedAgency();
    const code = await createInvitation(ownerToken, 1);
    expect((await registerDriver(code)).res.status).toBe(201);
    const second = await registerDriver(code);
    expect(second.res.status).toBe(400);
    expect(second.res.body.error.code).toBe('INVALID_INVITATION');
  });

  it('cannot escalate to agency owner via the driver flow', async () => {
    const { ownerToken } = await approvedAgency();
    const code = await createInvitation(ownerToken);
    const { res } = await registerDriver(code, { role: 'AGENCY_OWNER', roles: ['SUPER_ADMIN'] });
    expect(res.status).toBe(201);
    expect(res.body.data.user.roles).toEqual(['DRIVER']);
  });

  it('rejects an expired licence', async () => {
    const { res } = await registerDriver('ABCD-EFGH', { licenceExpiry: '2020-01-01' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.some((d: { field: string }) => d.field === 'licenceExpiry')).toBe(true);
  });

  it('driver login is mobile-friendly (refresh token returned only for mobile clients)', async () => {
    const { ownerToken } = await approvedAgency();
    const code = await createInvitation(ownerToken);
    const { phone } = await registerDriver(code, { password: PASSWORD, confirmPassword: PASSWORD });
    const m = await api().post('/api/v1/auth/login').set(mobile).send({ identifier: phone, password: PASSWORD });
    expect(m.body.data.refreshToken).toBeTruthy();
    const w = await api().post('/api/v1/auth/login').send({ identifier: phone, password: PASSWORD });
    expect(w.body.data.refreshToken).toBeUndefined();
    expect(String(w.headers['set-cookie'])).toMatch(/ttms_rt=.*HttpOnly/);
  });
});

describe('Simple signup (name + mobile + password)', () => {
  it('creates an active individual customer without OTP and signs them in', async () => {
    const phone = uniquePhone();
    const res = await api().post('/api/v1/auth/register').set(mobile).send({ fullName: 'Asha Rao', phone, password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.data.user.roles).toEqual(['CUSTOMER']);
    expect(res.body.data.redirectTo).toBe('/customer/dashboard');
    expect(res.body.data.accessToken).toBeTruthy();

    const db = await prisma.user.findUniqueOrThrow({ where: { phone }, include: { customer: true } });
    expect(db.accountStatus).toBe('ACTIVE');
    expect(db.isPhoneVerified).toBe(false);
    expect(db.customer).toMatchObject({ customerType: 'INDIVIDUAL', city: null, state: null });

    const login = await api().post('/api/v1/auth/login').set(mobile).send({ identifier: phone, password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it('rejects a phone number that is already registered', async () => {
    const { phone } = await registerCustomer();
    const res = await api().post('/api/v1/auth/register').send({ fullName: 'Someone Else', phone, password: PASSWORD });
    expect(res.status).toBe(409);
  });

  it('rejects a weak password', async () => {
    const res = await api().post('/api/v1/auth/register').send({ fullName: 'Asha Rao', phone: uniquePhone(), password: 'short' });
    expect(res.status).toBe(400);
  });
});
