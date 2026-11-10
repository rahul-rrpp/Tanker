import { describe, expect, it } from 'vitest';
import { getMockOtp } from '../src/modules/otp/providers/mock.provider';
import { api, approvedAgency, bearer, createInvitation, mobile, registerAgency, registerCustomer, registerDriver, uniquePhone } from './helpers';

describe('Unauthenticated access', () => {
  it.each([
    ['get', '/api/v1/auth/me'],
    ['get', '/api/v1/users/profile'],
    ['get', '/api/v1/agency/registration-status'],
    ['get', '/api/v1/admin/agencies'],
    ['post', '/api/v1/auth/logout-all'],
  ] as const)('%s %s → 401', async (method, path) => {
    const res = await api()[method](path);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('rejects garbage bearer tokens', async () => {
    const res = await api().get('/api/v1/auth/me').set(bearer('garbage'));
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});

describe('Role-based access', () => {
  it('customers cannot reach admin or agency endpoints', async () => {
    const { res } = await registerCustomer();
    const token = res.body.data.accessToken;
    expect((await api().get('/api/v1/admin/agencies').set(bearer(token))).status).toBe(403);
    expect((await api().get('/api/v1/agency/registration-status').set(bearer(token))).status).toBe(403);
    expect((await api().get('/api/v1/agency/drivers').set(bearer(token))).status).toBe(403);
  });

  it('agency owners cannot use admin endpoints', async () => {
    const { ownerToken, agencyId } = await approvedAgency();
    const res = await api().patch(`/api/v1/admin/agencies/${agencyId}/verification`).set(bearer(ownerToken)).send({ status: 'APPROVED' });
    expect(res.status).toBe(403);
  });

  it('profile updates cannot change roles, phone or status', async () => {
    const { res } = await registerCustomer();
    const patch = await api()
      .patch('/api/v1/users/profile')
      .set(bearer(res.body.data.accessToken))
      .send({ fullName: 'New Name', roles: ['SUPER_ADMIN'] });
    expect(patch.status).toBe(400);
    const ok = await api().patch('/api/v1/users/profile').set(bearer(res.body.data.accessToken)).send({ fullName: 'New Name' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.profile.fullName).toBe('New Name');
    expect(ok.body.data.profile.roles).toEqual(['CUSTOMER']);
  });

  it('super admin approves an agency, which unlocks agency operations', async () => {
    const { res } = await registerAgency();
    const ownerToken = res.body.data.accessToken;
    const { adminToken } = await approvedAgency();
    const list = await api().get('/api/v1/admin/agencies?status=PENDING_VERIFICATION').set(bearer(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data.agencies.some((a: { id: string }) => a.id === res.body.data.user.agency.id)).toBe(true);

    const reject = await api()
      .patch(`/api/v1/admin/agencies/${res.body.data.user.agency.id}/verification`)
      .set(bearer(adminToken))
      .send({ status: 'REJECTED' });
    expect(reject.status).toBe(400); // reason required

    await api()
      .patch(`/api/v1/admin/agencies/${res.body.data.user.agency.id}/verification`)
      .set(bearer(adminToken))
      .send({ status: 'APPROVED' })
      .expect(200);
    // Same access token — authorisation is evaluated from the DB on every request.
    expect((await api().post('/api/v1/agency/invitations').set(bearer(ownerToken)).send({})).status).toBe(201);
    const me = await api().get('/api/v1/auth/me').set(bearer(ownerToken));
    expect(me.body.data.redirectTo).toBe('/agency/dashboard');
  });

  it('owner creates a dispatcher who activates via OTP login and gets dispatcher permissions only', async () => {
    const { ownerToken } = await approvedAgency();
    const phone = uniquePhone();
    const created = await api()
      .post('/api/v1/agency/members')
      .set(bearer(ownerToken))
      .send({ fullName: 'Dinesh Kumar', phone, role: 'DISPATCHER' });
    expect(created.status).toBe(201);
    expect(created.body.data.member.user.accountStatus).toBe('PENDING_VERIFICATION');

    await api().post('/api/v1/auth/login/otp/send').send({ phone }).expect(200);
    const login = await api().post('/api/v1/auth/login/otp/verify').set(mobile).send({ phone, code: getMockOtp(phone) });
    expect(login.status).toBe(200);
    expect(login.body.data.user.accountStatus).toBe('ACTIVE');
    expect(login.body.data.redirectTo).toBe('/agency/operations');
    const token = login.body.data.accessToken;
    expect((await api().get('/api/v1/agency/drivers').set(bearer(token))).status).toBe(200);
    expect((await api().post('/api/v1/agency/invitations').set(bearer(token)).send({})).status).toBe(403);
    expect((await api().post('/api/v1/agency/members').set(bearer(token)).send({ fullName: 'X Y', phone: uniquePhone(), role: 'AGENCY_MANAGER' })).status).toBe(403);
  });

  it('owners cannot create staff with owner/driver/admin roles', async () => {
    const { ownerToken } = await approvedAgency();
    for (const role of ['AGENCY_OWNER', 'SUPER_ADMIN', 'DRIVER']) {
      const res = await api().post('/api/v1/agency/members').set(bearer(ownerToken)).send({ fullName: 'Bad Actor', phone: uniquePhone(), role });
      expect(res.status).toBe(400);
    }
  });
});

describe('Tenant isolation', () => {
  it('an agency cannot see or verify another agency\'s drivers or invitations', async () => {
    const a = await approvedAgency();
    const b = await approvedAgency();
    const code = await createInvitation(b.ownerToken);
    const { res } = await registerDriver(code);
    const driverId = (await api().get('/api/v1/agency/drivers').set(bearer(b.ownerToken))).body.data.drivers[0].id;
    expect(res.body.data.user.agency.id).toBe(b.agencyId);

    const aDrivers = await api().get('/api/v1/agency/drivers').set(bearer(a.ownerToken));
    expect(aDrivers.body.data.drivers).toHaveLength(0);

    const cross = await api().patch(`/api/v1/agency/drivers/${driverId}/verification`).set(bearer(a.ownerToken)).send({ status: 'APPROVED' });
    expect(cross.status).toBe(404);

    const bInvites = await api().get('/api/v1/agency/invitations').set(bearer(b.ownerToken));
    const revokeCross = await api().delete(`/api/v1/agency/invitations/${bInvites.body.data.invitations[0].id}`).set(bearer(a.ownerToken));
    expect(revokeCross.status).toBe(404);

    // The owning agency can approve, which updates the driver's landing route.
    await api().patch(`/api/v1/agency/drivers/${driverId}/verification`).set(bearer(b.ownerToken)).send({ status: 'APPROVED' }).expect(200);
    const me = await api().get('/api/v1/auth/me').set(bearer(res.body.data.accessToken));
    expect(me.body.data.user.driverVerificationStatus).toBe('APPROVED');
    expect(me.body.data.redirectTo).toBe('/driver/app');
  });

  it('drivers cannot use agency management endpoints', async () => {
    const { ownerToken } = await approvedAgency();
    const { res } = await registerDriver(await createInvitation(ownerToken));
    const token = res.body.data.accessToken;
    expect((await api().get('/api/v1/agency/drivers').set(bearer(token))).status).toBe(403);
    expect((await api().post('/api/v1/agency/invitations').set(bearer(token)).send({})).status).toBe(403);
  });
});
