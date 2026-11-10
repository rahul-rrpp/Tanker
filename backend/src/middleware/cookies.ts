import type { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env';
import { generateOpaqueToken } from '../utils/crypto';
import type { IssuedTokens } from '../modules/auth/token.service';

export const COOKIE_ACCESS = 'ttms_at';
export const COOKIE_REFRESH = 'ttms_rt';
export const COOKIE_CSRF = 'ttms_csrf';

function base(maxAgeMs: number | undefined, httpOnly = true): CookieOptions {
  return {
    httpOnly,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    domain: env.COOKIE_DOMAIN || undefined,
    ...(maxAgeMs === undefined ? {} : { maxAge: maxAgeMs }),
  };
}

/** Web sessions: tokens live only in httpOnly cookies; a readable CSRF cookie enables double-submit. */
export function setAuthCookies(res: Response, tokens: IssuedTokens) {
  // Without "Remember me" the refresh/CSRF cookies are browser-session cookies (cleared on browser close).
  const refreshMs = tokens.persistent ? tokens.refreshTokenExpiresAt.getTime() - Date.now() : undefined;
  res.cookie(COOKIE_ACCESS, tokens.accessToken, base(tokens.accessTokenExpiresIn * 1000));
  res.cookie(COOKIE_REFRESH, tokens.refreshToken, base(refreshMs));
  res.cookie(COOKIE_CSRF, generateOpaqueToken(24), base(refreshMs, false));
}

export function clearAuthCookies(res: Response) {
  for (const name of [COOKIE_ACCESS, COOKIE_REFRESH, COOKIE_CSRF]) {
    res.clearCookie(name, { path: '/', domain: env.COOKIE_DOMAIN || undefined, secure: env.COOKIE_SECURE, sameSite: 'lax' });
  }
}

export function readCookie(req: Request, name: string): string | undefined {
  const v = (req.cookies as Record<string, unknown> | undefined)?.[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
