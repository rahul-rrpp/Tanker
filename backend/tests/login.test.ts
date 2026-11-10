import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { getMockOtp } from '../src/modules/otp/providers/mock.provider';
import { api, bearer, createSuperAdmin, mobile, PASSWORD, registerAgency, registerCustomer, uniqueEmail, uniquePhone } from './helpers';

const login = (identifier: string, password: string) =>
  api().post('/api/v1/auth/login').set(mobile).send({ identifier, password, deviceInfo: 'Pixel 8 / Android 15' });

describe('Password login', () => {
  it('logs in with phone + password and returns the standard envelope', async () => {
    const { phone } = await registerCustomer();
    const res = await login(phone, PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      message: 'Login successful',
      data: { user: { phone, roles: ['CUSTOMER'], accountStatus: 'ACTIVE' }, redirectTo: '/customer/dashboard' },
    });
    expect(res.body.data.user.passwordHash).toBeUndefined();
    const audit = await prisma.loginAudit.findFirst({ where: { identifier: phone, event: 'LOGIN_SUCCESS' } });
    expect(audit?.method).toBe('PASSWORD');
  });

  it('logs in with email + password (case-insensitive email)', async () => {
    const email = uniqueEmail();
    await registerCustomer({ email });
    expect((await login(email.toUpperCase(), PASSWORD)).status).toBe(200);
  });

  it('rejects an incorrect password', async () => {
    const { phone } = await registerCustomer();
    const res = await login(phone, 'WrongPass1');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('gives the same error for unknown accounts (no enumeration)', async () => {
    const res = await login(uniquePhone(), PASSWORD);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.message).toBe('Invalid mobile number/email or password');
  });

  it('locks the account after repeated failures', async () => {
    const { phone } = await registerCustomer();
    for (let i = 0; i < 5; i++) expect((await login(phone, 'WrongPass1')).status).toBe(401);
    const locked = await login(phone, PASSWORD);
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('blocks suspended accounts', async () => {
    const { phone, res } = await registerCustomer();
    const admin = await createSuperAdmin();
    await api()
      .patch(`/api/v1/admin/users/${res.body.data.user.id}/status`)
      .set(bearer(admin.token))
      .send({ accountStatus: 'SUSPENDED' })
      .expect(200);
    const attempt = await login(phone, PASSWORD);
    expect(attempt.status).toBe(403);
    expect(attempt.body.error.code).toBe('ACCOUNT_SUSPENDED');
    // Existing sessions were revoked as well.
    const me = await api().get('/api/v1/auth/me').set(bearer(res.body.data.accessToken));
    expect(me.status).toBe(401);
  });

  it('routes a pending agency owner to the pending page', async () => {
    const { phone } = await registerAgency();
    const res = await login(phone, PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.data.redirectTo).toBe('/pending-verification');
    expect(res.body.data.user.agency.verificationStatus).toBe('PENDING_VERIFICATION');
  });

  it('routes a super admin to the admin dashboard', async () => {
    const admin = await createSuperAdmin();
    const res = await login(admin.email, PASSWORD);
    expect(res.body.data.redirectTo).toBe('/admin/dashboard');
  });
});

describe('OTP login', () => {
  it('logs in with mobile + OTP and consumes the code', async () => {
    const { phone } = await registerCustomer({ password: undefined, confirmPassword: undefined });
    await api().post('/api/v1/auth/login/otp/send').send({ phone }).expect(200);
    const code = getMockOtp(phone)!;
    const res = await api().post('/api/v1/auth/login/otp/verify').set(mobile).send({ phone, code });
    expect(res.status).toBe(200);
    expect(res.body.data.user.phone).toBe(phone);
    const reuse = await api().post('/api/v1/auth/login/otp/verify').set(mobile).send({ phone, code });
    expect(reuse.status).toBe(400);
  });

  it('responds identically for unregistered numbers and sends nothing', async () => {
    const phone = uniquePhone();
    const res = await api().post('/api/v1/auth/login/otp/send').send({ phone });
    expect(res.status).toBe(200);
    expect(getMockOtp(phone)).toBeUndefined();
    const verify = await api().post('/api/v1/auth/login/otp/verify').send({ phone, code: '123456' });
    expect(verify.status).toBe(400);
  });

  it('password login is rejected for OTP-only accounts with the generic error', async () => {
    const { phone } = await registerCustomer({ password: undefined, confirmPassword: undefined });
    expect((await login(phone, PASSWORD)).body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('Password reset & change', () => {
  it('resets a password with an OTP and revokes existing sessions', async () => {
    const { phone, res: reg } = await registerCustomer();
    await api().post('/api/v1/auth/forgot-password').send({ identifier: phone }).expect(200);
    const code = getMockOtp(phone)!;
    await api()
      .post('/api/v1/auth/reset-password')
      .send({ identifier: phone, code, password: 'NewPassw0rd', confirmPassword: 'NewPassw0rd' })
      .expect(200);
    expect((await api().get('/api/v1/auth/me').set(bearer(reg.body.data.accessToken))).status).toBe(401);
    expect((await login(phone, PASSWORD)).status).toBe(401);
    expect((await login(phone, 'NewPassw0rd')).status).toBe(200);
  });

  it('changes a password (requires the current one) and signs out other devices', async () => {
    const { phone, res: reg } = await registerCustomer();
    const other = await login(phone, PASSWORD);
    const wrong = await api()
      .post('/api/v1/auth/change-password')
      .set(bearer(reg.body.data.accessToken))
      .send({ currentPassword: 'nope', password: 'An0therPass', confirmPassword: 'An0therPass' });
    expect(wrong.status).toBe(400);
    const res = await api()
      .post('/api/v1/auth/change-password')
      .set(bearer(reg.body.data.accessToken))
      .send({ currentPassword: PASSWORD, password: 'An0therPass', confirmPassword: 'An0therPass' });
    expect(res.status).toBe(200);
    expect(res.body.data.otherSessionsRevoked).toBe(1);
    expect((await api().get('/api/v1/auth/me').set(bearer(reg.body.data.accessToken))).status).toBe(200);
    expect((await api().get('/api/v1/auth/me').set(bearer(other.body.data.accessToken))).status).toBe(401);
  });
});
