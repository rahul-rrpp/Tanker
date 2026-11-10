import type { ClientType } from '@prisma/client';
import type { Request } from 'express';

/** Request metadata recorded on sessions and audit rows. */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  clientType: ClientType;
  deviceInfo: string | null;
  /** "Remember me". false = short-lived session with browser-session cookies. */
  persistent?: boolean;
  /** Absolute session length override (admin sessions). */
  expirySeconds?: number;
}

/**
 * Mobile apps identify themselves with `X-Client-Type: mobile` and receive the refresh token in
 * the response body (stored in SecureStore). All other clients are treated as web and receive
 * httpOnly cookies only.
 */
export function getClientType(req: Request): ClientType {
  return String(req.headers['x-client-type'] ?? '').toLowerCase() === 'mobile' ? 'MOBILE' : 'WEB';
}

export function requestContext(req: Request, deviceInfo?: string | null): RequestContext {
  const ua = req.headers['user-agent'] ?? null;
  return {
    ip: req.ip ?? null,
    userAgent: ua ? ua.slice(0, 300) : null,
    clientType: getClientType(req),
    deviceInfo: (deviceInfo ?? (req.headers['x-device-info'] as string | undefined) ?? null)?.slice(0, 200) ?? null,
  };
}
