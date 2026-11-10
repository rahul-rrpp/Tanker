import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { safeEqualHex } from '../utils/crypto';
import { AppError, ErrorCode } from '../utils/errors';
import { COOKIE_ACCESS, COOKIE_CSRF, COOKIE_REFRESH, readCookie } from './cookies';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const toHex = (s: string) => Buffer.from(s, 'utf8').toString('hex');

/**
 * CSRF protection for cookie-authenticated requests (web).
 *  - Requests authenticated with an Authorization header (mobile) are not CSRF-prone and skip the check.
 *  - Otherwise, state-changing requests that carry session cookies must echo the readable
 *    `ttms_csrf` cookie in the `X-CSRF-Token` header (double-submit) and come from an allowed Origin.
 * Cookies are also SameSite=Lax, which blocks cross-site POSTs in modern browsers.
 */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.headers.authorization?.startsWith('Bearer ')) return next();
  const hasSessionCookie = Boolean(readCookie(req, COOKIE_ACCESS) || readCookie(req, COOKIE_REFRESH));
  if (!hasSessionCookie) return next();

  const origin = req.headers.origin;
  if (origin && !env.corsOrigins.includes(origin) && origin !== env.WEB_APP_URL) {
    return next(AppError.forbidden('Request origin not allowed', ErrorCode.CSRF_FAILED));
  }
  const cookie = readCookie(req, COOKIE_CSRF);
  const header = req.headers['x-csrf-token'];
  if (!cookie || typeof header !== 'string' || !safeEqualHex(toHex(cookie), toHex(header))) {
    return next(AppError.forbidden('Missing or invalid CSRF token', ErrorCode.CSRF_FAILED));
  }
  next();
};
