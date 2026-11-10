import type { Request, Response } from 'express';
import { clearAuthCookies, COOKIE_REFRESH, readCookie, setAuthCookies } from '../../middleware/cookies';
import { AppError, ErrorCode } from '../../utils/errors';
import { created, ok } from '../../utils/response';
import { issueVerificationToken, verifyOtp } from '../otp/otp.service';
import * as auth from './auth.service';
import { writeAudit } from './audit.service';
import { getClientType, requestContext } from './context';
import { loadPrincipal, publicUser, resolveRedirect } from './principal';
import { findSessionByRefreshToken, listActiveSessions, revokeAllUserSessions, revokeFamily } from './token.service';

/**
 * Web: tokens are set as httpOnly cookies; the refresh token is never exposed to JavaScript.
 * Mobile (X-Client-Type: mobile): tokens are returned in the body for SecureStore.
 */
export function sendAuthResult(req: Request, res: Response, result: auth.AuthResult, message: string, status = 200) {
  const mobile = getClientType(req) === 'MOBILE';
  if (!mobile) setAuthCookies(res, result.tokens);
  const data = {
    ...('company' in result ? { company: (result as { company: unknown }).company } : {}),
    ...('transporter' in result ? { transporter: (result as { transporter: unknown }).transporter } : {}),
    accessToken: result.tokens.accessToken,
    accessTokenExpiresIn: result.tokens.accessTokenExpiresIn,
    ...(mobile
      ? { refreshToken: result.tokens.refreshToken, refreshTokenExpiresAt: result.tokens.refreshTokenExpiresAt.toISOString() }
      : {}),
    sessionId: result.tokens.sessionId,
    user: result.user,
    redirectTo: result.redirectTo,
  };
  return status === 201 ? created(res, message, data) : ok(res, message, data);
}

function refreshTokenFrom(req: Request): string | undefined {
  return (req.body as { refreshToken?: string } | undefined)?.refreshToken ?? readCookie(req, COOKIE_REFRESH);
}

// ---- OTP ------------------------------------------------------------------------------

export async function sendOtp(req: Request, res: Response) {
  const result = await auth.sendRegistrationOtp(req.body, req.ip ?? null);
  return ok(res, 'Verification code sent', result);
}

export async function verifyOtpHandler(req: Request, res: Response) {
  const otp = await verifyOtp(req.body.destination, req.body.purpose, req.body.code);
  return ok(res, 'Verified successfully', { verificationToken: issueVerificationToken(otp) });
}

// ---- Registration ----------------------------------------------------------------------

export async function registerAgency(req: Request, res: Response) {
  const result = await auth.registerAgency(req.body, requestContext(req, req.body.deviceInfo));
  return sendAuthResult(req, res, result, 'Registration submitted. Your agency is pending verification.', 201);
}

export async function registerDriver(req: Request, res: Response) {
  const result = await auth.registerDriver(req.body, requestContext(req, req.body.deviceInfo));
  return sendAuthResult(req, res, result, 'Registration successful. Your profile is pending agency verification.', 201);
}

export async function registerCustomer(req: Request, res: Response) {
  const result = await auth.registerCustomer(req.body, requestContext(req, req.body.deviceInfo));
  return sendAuthResult(req, res, result, 'Registration successful', 201);
}

export async function registerCompany(req: Request, res: Response) {
  const result = await auth.registerCompany(req.body, { ...requestContext(req, req.body.deviceInfo), persistent: true });
  const response = sendAuthResult(req, res, result, `Registration successful. Your company ID is ${result.company.companyCode}.`, 201);
  return response;
}

export async function loginHistory(req: Request, res: Response) {
  return ok(res, 'Login history', { history: await auth.loginHistory(req.auth!.principal.userId) });
}

export async function contactChangeSend(req: Request, res: Response) {
  const result = await auth.sendContactChangeOtp(req.auth!.principal.userId, req.body, req.ip ?? null);
  return ok(res, 'Verification code sent', result);
}

export async function contactChangeVerify(req: Request, res: Response) {
  await auth.confirmContactChange(req.auth!.principal.userId, req.body);
  const p = (await loadPrincipal(req.auth!.principal.userId))!;
  return ok(res, 'Contact details updated', { user: publicUser(p) });
}

export async function registerSimple(req: Request, res: Response) {
  const result = await auth.registerSimple(req.body, requestContext(req, req.body.deviceInfo));
  return sendAuthResult(req, res, result, 'Registration successful', 201);
}

// ---- Login ------------------------------------------------------------------------------

const withRemember = (req: Request) => ({ ...requestContext(req, req.body.deviceInfo), persistent: req.body.rememberMe !== false });

export async function login(req: Request, res: Response) {
  const result = await auth.loginWithPassword(req.body, withRemember(req));
  return sendAuthResult(req, res, result, 'Login successful');
}

export async function loginOtpSend(req: Request, res: Response) {
  const result = await auth.sendLoginOtp(req.body.phone, req.ip ?? null);
  return ok(res, 'If this number is registered, a verification code has been sent', result);
}

export async function loginOtpVerify(req: Request, res: Response) {
  const result = await auth.loginWithOtp(req.body, withRemember(req));
  return sendAuthResult(req, res, result, 'Login successful');
}

// ---- Session ------------------------------------------------------------------------------

export async function refresh(req: Request, res: Response) {
  const token = refreshTokenFrom(req);
  if (!token) throw AppError.unauthorized('No refresh token provided', ErrorCode.INVALID_TOKEN);
  try {
    const result = await auth.refreshSession(token, requestContext(req));
    return sendAuthResult(req, res, result, 'Session refreshed');
  } catch (e) {
    // A conflict means another request already rotated the cookie; keep the new cookies intact.
    if (!(e instanceof AppError && e.code === ErrorCode.REFRESH_CONFLICT)) clearAuthCookies(res);
    throw e;
  }
}

/** Logs out the current device. Works with either an access token or just the refresh token. */
export async function logout(req: Request, res: Response) {
  const ctx = requestContext(req);
  let familyId = req.auth?.sessionId;
  let userId = req.auth?.principal.userId;
  if (!familyId) {
    const token = refreshTokenFrom(req);
    const session = token ? await findSessionByRefreshToken(token) : null;
    familyId = session?.familyId;
    userId = session?.userId;
  }
  if (familyId) {
    await revokeFamily(familyId, 'LOGOUT');
    await writeAudit({ userId, event: 'LOGOUT', success: true, ctx });
  }
  clearAuthCookies(res);
  return ok(res, 'Logged out', null);
}

export async function logoutAll(req: Request, res: Response) {
  const userId = req.auth!.principal.userId;
  const count = await revokeAllUserSessions(userId, 'LOGOUT_ALL');
  await writeAudit({ userId, event: 'LOGOUT_ALL', success: true, ctx: requestContext(req) });
  clearAuthCookies(res);
  return ok(res, 'Logged out from all devices', { sessionsRevoked: count });
}

export async function me(req: Request, res: Response) {
  const p = req.auth!.principal;
  return ok(res, 'Current user', { user: publicUser(p), redirectTo: resolveRedirect(p), sessionId: req.auth!.sessionId });
}

export async function sessions(req: Request, res: Response) {
  const list = await listActiveSessions(req.auth!.principal.userId);
  return ok(res, 'Active sessions', {
    sessions: list.map((s) => ({ ...s, id: s.familyId, current: s.familyId === req.auth!.sessionId })),
  });
}

export async function revokeSession(req: Request, res: Response) {
  const { sessionId } = res.locals.params as { sessionId: string };
  const userId = req.auth!.principal.userId;
  const result = await auth.revokeOwnSession(userId, sessionId);
  if (!result) throw AppError.notFound('Session not found');
  if (sessionId === req.auth!.sessionId) clearAuthCookies(res);
  return ok(res, 'Session revoked', null);
}

// ---- Passwords ------------------------------------------------------------------------------

export async function changePassword(req: Request, res: Response) {
  const result = await auth.changePassword(req.auth!.principal.userId, req.auth!.sessionId, req.body, requestContext(req));
  return ok(res, 'Password updated. Other devices have been signed out.', result);
}

export async function forgotPassword(req: Request, res: Response) {
  const result = await auth.forgotPassword(req.body.identifier, req.ip ?? null);
  return ok(res, 'If an account exists, a reset code has been sent', result);
}

export async function resetPassword(req: Request, res: Response) {
  await auth.resetPassword(req.body, requestContext(req));
  clearAuthCookies(res);
  return ok(res, 'Password reset successfully. Please sign in.', null);
}
