import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { loginLimiter, otpLimiter } from '../../middleware/rateLimit';
import { AppError, ErrorCode } from '../../utils/errors';
import { ok } from '../../utils/response';
import { otpCodeSchema } from '../../utils/validators';
import { audit } from '../audit/audit';
import { sendAuthResult } from '../auth/auth.controller';
import { startSession, verifyPasswordLogin } from '../auth/auth.service';
import { writeAudit } from '../auth/audit.service';
import { requestContext } from '../auth/context';
import { publicUser } from '../auth/principal';
import { sendOtp, verifyAndConsumeOtp } from '../otp/otp.service';
import { adminAuth, body } from './core';

/**
 * Admin Portal sign-in (separate from the company login):
 *   1. POST /admin/auth/login        identifier + password (lockout, account + employee status checks)
 *   2. POST /admin/auth/verify-2fa   one-time code sent to the admin's email (or mobile) -> session
 * Sessions are browser-session cookies limited to ADMIN_SESSION_EXPIRY. Sign-ins from a new IP and
 * device raise a suspicious-login alert to the account holder and every Super Admin.
 * There is no admin self-registration: the first Super Admin is created with `npm run create-super-admin`.
 */
export const adminAuthRouter = Router();

const AUDIENCE = 'ttms-admin-2fa';
type Challenge = { typ: 'admin_2fa'; sub: string; dest: string; ch: 'EMAIL' | 'SMS' };

function signChallenge(c: Omit<Challenge, 'typ'>) {
  return jwt.sign({ typ: 'admin_2fa', ...c }, env.JWT_ACCESS_SECRET, { algorithm: 'HS256', issuer: env.JWT_ISSUER, audience: AUDIENCE, expiresIn: 600 });
}
function readChallenge(token: string): Challenge {
  try {
    const c = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: env.JWT_ISSUER, audience: AUDIENCE }) as Challenge;
    if (c.typ !== 'admin_2fa') throw new Error('type');
    return c;
  } catch {
    throw AppError.unauthorized('Your sign-in attempt expired. Please sign in again.', ErrorCode.INVALID_TOKEN);
  }
}

adminAuthRouter.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const input = body(req, z.object({ identifier: z.string().trim().min(3).max(254), password: z.string().min(1).max(128) }).strict());
  const ctx = requestContext(req, 'Admin web');
  const { user } = await verifyPasswordLogin(input, ctx, 'admin');
  const channel: 'EMAIL' | 'SMS' = user.email ? 'EMAIL' : 'SMS';
  const dest = user.email ?? user.phone;
  const sent = await sendOtp({ destination: dest, channel, purpose: 'ADMIN_2FA', ip: req.ip });
  ok(res, 'Enter the verification code to finish signing in', {
    challengeToken: signChallenge({ sub: user.id, dest, ch: channel }),
    channel,
    destination: sent.destination,
    expiresInSeconds: sent.expiresInSeconds,
    resendAfterSeconds: sent.resendAfterSeconds,
    ...(sent.devCode ? { devCode: sent.devCode } : {}),
  });
});

adminAuthRouter.post('/resend-2fa', otpLimiter, async (req: Request, res: Response) => {
  const { challengeToken } = body(req, z.object({ challengeToken: z.string().min(20).max(2000) }));
  const c = readChallenge(challengeToken);
  const sent = await sendOtp({ destination: c.dest, channel: c.ch, purpose: 'ADMIN_2FA', ip: req.ip });
  ok(res, 'Code re-sent', { destination: sent.destination, resendAfterSeconds: sent.resendAfterSeconds, ...(sent.devCode ? { devCode: sent.devCode } : {}) });
});

adminAuthRouter.post('/verify-2fa', loginLimiter, async (req: Request, res: Response) => {
  const input = body(req, z.object({ challengeToken: z.string().min(20).max(2000), code: otpCodeSchema }));
  const c = readChallenge(input.challengeToken);
  const ctx = { ...requestContext(req, 'Admin web'), persistent: false, expirySeconds: env.ADMIN_SESSION_EXPIRY };
  try {
    await verifyAndConsumeOtp(c.dest, 'ADMIN_2FA', input.code);
  } catch (e) {
    await writeAudit({ userId: c.sub, identifier: c.dest, event: 'LOGIN_FAILED', method: 'OTP', success: false, failureReason: 'ADMIN_2FA_FAILED', ctx });
    throw e;
  }

  // Suspicious sign-in: a new IP *and* a new device compared with the last 90 days of successful logins.
  const recent = await prisma.loginAudit.findMany({
    where: { userId: c.sub, event: 'LOGIN_SUCCESS', success: true, createdAt: { gte: new Date(Date.now() - 90 * 86400_000) } },
    select: { ipAddress: true, userAgent: true },
    take: 200,
  });
  const suspicious = recent.length > 0 && !recent.some((r) => r.ipAddress === ctx.ip) && !recent.some((r) => r.userAgent === ctx.userAgent);

  await prisma.user.update({ where: { id: c.sub }, data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await writeAudit({ userId: c.sub, identifier: c.dest, event: 'LOGIN_SUCCESS', method: 'PASSWORD', success: true, ctx });
  const result = await startSession(c.sub, ctx);
  await audit({ action: 'admin.login', entityType: 'user', entityId: c.sub, actorUserId: c.sub, actorType: result.user.roles.includes('SUPER_ADMIN') ? 'ADMIN' : 'EMPLOYEE', module: 'auth', metadata: { suspicious, ip: ctx.ip }, req });

  if (suspicious) {
    const supers = await prisma.user.findMany({ where: { roles: { some: { role: { name: 'SUPER_ADMIN' } } } }, select: { id: true } });
    const recipients = [...new Set([c.sub, ...supers.map((s) => s.id)])];
    await prisma.notification.createMany({
      data: recipients.map((userId) => ({
        userId,
        type: 'ADMIN_ALERT' as const,
        title: 'Suspicious admin sign-in',
        message: `${result.user.fullName} signed in from a new device and IP (${ctx.ip ?? 'unknown'}). If this was not expected, revoke the session in Employee Management.`,
        link: '/admin/audit',
      })),
    });
  }
  return sendAuthResult(req, res, { ...result, redirectTo: '/admin/dashboard' }, 'Signed in');
});

adminAuthRouter.get('/me', ...adminAuth, async (req: Request, res: Response) => {
  const p = req.auth!.principal;
  ok(res, 'Admin', { user: publicUser(p), isSuper: req.admin!.isSuper, permissions: req.admin!.isSuper ? ['*'] : p.permissions.filter((k) => k.startsWith('adm.')), sessionId: req.auth!.sessionId });
});
