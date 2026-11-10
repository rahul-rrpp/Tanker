import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { prisma } from '../src/lib/prisma';
import { api, bearer, mobile, PASSWORD, registerCustomer } from './helpers';

async function mobileSession() {
  const { phone } = await registerCustomer();
  const res = await api().post('/api/v1/auth/login').set(mobile).send({ identifier: phone, password: PASSWORD }).expect(200);
  return { phone, accessToken: res.body.data.accessToken as string, refreshToken: res.body.data.refreshToken as string };
}

const refresh = (refreshToken: string) => api().post('/api/v1/auth/refresh').set(mobile).send({ refreshToken });

function cookieJar(setCookie: string[] | string | undefined) {
  const list = ([] as string[]).concat(setCookie ?? []);
  const jar: Record<string, string> = {};
  for (const c of list) {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    jar[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return jar;
}
const cookieHeader = (jar: Record<string, string>) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

describe('Token refresh & rotation', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const s = await mobileSession();
    const res = await refresh(s.refreshToken);
    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).not.toBe(s.refreshToken);
    expect((await api().get('/api/v1/auth/me').set(bearer(res.body.data.accessToken))).status).toBe(200);
    // Stored hash, not the raw token.
    expect(await prisma.refreshSession.findFirst({ where: { tokenHash: s.refreshToken } })).toBeNull();
  });

  it('detects refresh token reuse and revokes the whole session family', async () => {
    const s = await mobileSession();
    const rotated = await refresh(s.refreshToken).expect(200);
    // Move the rotation outside the race grace window.
    await prisma.refreshSession.updateMany({
      where: { revokedReason: 'ROTATED', replacedById: { not: null }, revokedAt: { gt: new Date(Date.now() - 60_000) } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    const reuse = await refresh(s.refreshToken);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('REFRESH_TOKEN_REUSED');
    // The legitimately rotated token is now dead too, and so is the access token.
    expect((await refresh(rotated.body.data.refreshToken)).status).toBe(401);
    expect((await api().get('/api/v1/auth/me').set(bearer(rotated.body.data.accessToken))).status).toBe(401);
    const audit = await prisma.loginAudit.findFirst({ where: { event: 'REFRESH_TOKEN_REUSE' }, orderBy: { createdAt: 'desc' } });
    expect(audit).not.toBeNull();
  });

  it('treats a near-simultaneous double refresh as a benign conflict', async () => {
    const s = await mobileSession();
    await refresh(s.refreshToken).expect(200);
    const second = await refresh(s.refreshToken);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('REFRESH_CONFLICT');
  });

  it('rejects an expired session', async () => {
    const s = await mobileSession();
    const claims = jwt.decode(s.accessToken) as { sid: string };
    await prisma.refreshSession.updateMany({ where: { familyId: claims.sid }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await refresh(s.refreshToken)).body.error.code).toBe('SESSION_REVOKED');
    expect((await api().get('/api/v1/auth/me').set(bearer(s.accessToken))).status).toBe(401);
  });

  it('rejects an expired access token with TOKEN_EXPIRED', async () => {
    const s = await mobileSession();
    const claims = jwt.decode(s.accessToken) as Record<string, unknown>;
    const expired = jwt.sign(
      { sub: claims.sub, sid: claims.sid, typ: 'access', iat: Math.floor(Date.now() / 1000) - 3600, exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_ACCESS_SECRET!,
      { issuer: 'ttms-auth', audience: 'ttms' },
    );
    const res = await api().get('/api/v1/auth/me').set(bearer(expired));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects tampered tokens', async () => {
    const s = await mobileSession();
    const forged = jwt.sign({ ...(jwt.decode(s.accessToken) as object) }, 'attacker-secret-attacker-secret-1234');
    expect((await api().get('/api/v1/auth/me').set(bearer(forged))).body.error.code).toBe('INVALID_TOKEN');
  });
});

describe('Logout', () => {
  it('logs out the current device only', async () => {
    const { phone } = await registerCustomer();
    const a = await api().post('/api/v1/auth/login').set(mobile).send({ identifier: phone, password: PASSWORD });
    const b = await api().post('/api/v1/auth/login').set(mobile).send({ identifier: phone, password: PASSWORD });
    await api().post('/api/v1/auth/logout').set(mobile).send({ refreshToken: a.body.data.refreshToken }).expect(200);
    expect((await api().get('/api/v1/auth/me').set(bearer(a.body.data.accessToken))).status).toBe(401);
    expect((await refresh(a.body.data.refreshToken)).body.error.code).toBe('SESSION_REVOKED');
    expect((await api().get('/api/v1/auth/me').set(bearer(b.body.data.accessToken))).status).toBe(200);
  });

  it('logs out from all devices', async () => {
    const { phone } = await registerCustomer();
    const a = await api().post('/api/v1/auth/login').set(mobile).send({ identifier: phone, password: PASSWORD });
    const b = await api().post('/api/v1/auth/login').set(mobile).send({ identifier: phone, password: PASSWORD });
    const list = await api().get('/api/v1/auth/sessions').set(bearer(a.body.data.accessToken));
    expect(list.body.data.sessions.length).toBeGreaterThanOrEqual(3); // registration + 2 logins
    expect(list.body.data.sessions.filter((x: { current: boolean }) => x.current)).toHaveLength(1);
    const res = await api().post('/api/v1/auth/logout-all').set(bearer(a.body.data.accessToken)).expect(200);
    expect(res.body.data.sessionsRevoked).toBeGreaterThanOrEqual(3);
    expect((await api().get('/api/v1/auth/me').set(bearer(b.body.data.accessToken))).status).toBe(401);
  });

  it('revokes a specific session by id', async () => {
    const { phone } = await registerCustomer();
    const a = await api().post('/api/v1/auth/login').set(mobile).send({ identifier: phone, password: PASSWORD });
    const b = await api().post('/api/v1/auth/login').set(mobile).send({ identifier: phone, password: PASSWORD });
    await api().delete(`/api/v1/auth/sessions/${b.body.data.sessionId}`).set(bearer(a.body.data.accessToken)).expect(200);
    expect((await api().get('/api/v1/auth/me').set(bearer(b.body.data.accessToken))).status).toBe(401);
  });
});

describe('Web cookie sessions & CSRF', () => {
  it('sets httpOnly cookies, authenticates via cookie and enforces CSRF on mutations', async () => {
    const { phone } = await registerCustomer();
    const login = await api().post('/api/v1/auth/login').send({ identifier: phone, password: PASSWORD }).expect(200);
    const setCookie = login.headers['set-cookie'] as unknown as string[];
    expect(setCookie.find((c) => c.startsWith('ttms_at='))).toMatch(/HttpOnly/);
    expect(setCookie.find((c) => c.startsWith('ttms_rt='))).toMatch(/HttpOnly; SameSite=Lax/);
    expect(setCookie.find((c) => c.startsWith('ttms_csrf='))).not.toMatch(/HttpOnly/);
    expect(login.body.data.refreshToken).toBeUndefined();

    const jar = cookieJar(setCookie);
    expect((await api().get('/api/v1/auth/me').set('Cookie', cookieHeader(jar))).status).toBe(200);

    const noCsrf = await api().post('/api/v1/auth/refresh').set('Cookie', cookieHeader(jar)).send({});
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('CSRF_FAILED');

    const badOrigin = await api()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(jar))
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', jar.ttms_csrf)
      .send({});
    expect(badOrigin.status).toBe(403);

    const ok = await api()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(jar))
      .set('Origin', 'http://localhost:3000')
      .set('X-CSRF-Token', jar.ttms_csrf)
      .send({});
    expect(ok.status).toBe(200);
    const rotated = cookieJar(ok.headers['set-cookie'] as unknown as string[]);
    expect(rotated.ttms_rt).not.toBe(jar.ttms_rt);

    const logout = await api()
      .post('/api/v1/auth/logout')
      .set('Cookie', cookieHeader(rotated))
      .set('X-CSRF-Token', rotated.ttms_csrf)
      .send({});
    expect(logout.status).toBe(200);
    expect(String(logout.headers['set-cookie'])).toMatch(/ttms_rt=;/);
    expect((await api().get('/api/v1/auth/me').set('Cookie', cookieHeader(rotated))).status).toBe(401);
  });
});
