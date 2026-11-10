import rateLimit, { type Options } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { fail } from '../utils/response';
import { ErrorCode } from '../utils/errors';

/**
 * IP-based rate limiters (in-memory store). For multiple backend instances configure a shared
 * store (e.g. rate-limit-redis) — see docs/DEPLOYMENT.md.
 * Per-account brute-force protection (lockout) and per-destination OTP limits are enforced in the
 * database and therefore work across instances.
 */
function limiter(windowMs: number, limit: number, message: string): RequestHandler {
  if (!env.RATE_LIMIT_ENABLED) return (_req, _res, next) => next();
  const options: Partial<Options> = {
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      fail(res, 429, message, ErrorCode.RATE_LIMITED);
    },
  };
  return rateLimit(options);
}

export const apiLimiter = limiter(15 * 60_000, 600, 'Too many requests. Please slow down.');
export const loginLimiter = limiter(15 * 60_000, 30, 'Too many sign-in attempts. Try again in a few minutes.');
export const otpLimiter = limiter(15 * 60_000, 15, 'Too many verification requests. Try again later.');
export const mapsLimiter = limiter(60_000, 90, 'Too many map requests. Please slow down.');
export const registrationLimiter = limiter(60 * 60_000, 20, 'Too many registration attempts. Try again later.');
