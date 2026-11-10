import type { RoleName } from '@prisma/client';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { rolesAllowed } from '../config/portals';
import type { PermissionKey } from '../config/rbac';
import { loadPrincipal } from '../modules/auth/principal';
import { isSessionActive, verifyAccessToken } from '../modules/auth/token.service';
import { AppError, ErrorCode } from '../utils/errors';
import { COOKIE_ACCESS, readCookie } from './cookies';

function extractAccessToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || undefined;
  return readCookie(req, COOKIE_ACCESS);
}

/**
 * Verifies the access token (Bearer header for mobile, httpOnly cookie for web), checks that the
 * session has not been revoked, and loads roles/permissions/agency from the database.
 */
export const authenticateUser: RequestHandler = async (req, _res, next) => {
  const token = extractAccessToken(req);
  if (!token) return next(AppError.unauthorized());

  const claims = verifyAccessToken(token);
  if (!(await isSessionActive(claims.sub, claims.sid))) {
    return next(AppError.unauthorized('Session has ended. Please sign in again.', ErrorCode.SESSION_REVOKED));
  }
  const principal = await loadPrincipal(claims.sub);
  if (!principal) return next(AppError.unauthorized('Account no longer exists', ErrorCode.INVALID_TOKEN));
  if (principal.accountStatus === 'SUSPENDED') {
    return next(AppError.forbidden('Your account has been suspended', ErrorCode.ACCOUNT_SUSPENDED));
  }
  if (principal.accountStatus === 'DEACTIVATED') {
    return next(AppError.forbidden('Your account has been deactivated', ErrorCode.ACCOUNT_DEACTIVATED));
  }
  if (!rolesAllowed(principal.roles) || principal.employee?.blocked) {
    return next(AppError.forbidden('This portal is not available yet', ErrorCode.PORTAL_NOT_AVAILABLE));
  }
  req.auth = { principal, sessionId: claims.sid };
  next();
};

function principalOf(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth.principal;
}

/** Allows the request if the user holds at least one of the given roles. */
export function authorizeRoles(...roles: RoleName[]): RequestHandler {
  return (req, _res, next) => {
    const p = principalOf(req);
    if (!roles.some((r) => p.roles.includes(r))) return next(AppError.forbidden());
    next();
  };
}

/** Allows the request only if the user holds every listed permission. */
export function authorizePermissions(...permissions: PermissionKey[]): RequestHandler {
  return (req, _res, next) => {
    const p = principalOf(req);
    if (!permissions.every((perm) => p.permissions.includes(perm))) return next(AppError.forbidden());
    next();
  };
}

/** Requires a verified phone number and an ACTIVE account. */
export const requireVerifiedAccount: RequestHandler = (req, _res, next) => {
  const p = principalOf(req);
  if (p.accountStatus !== 'ACTIVE' || !p.isPhoneVerified) {
    return next(AppError.forbidden('Verify your account to continue', ErrorCode.ACCOUNT_NOT_VERIFIED));
  }
  next();
};

/**
 * Resolves the caller's agency from their membership (tenant isolation). If a route carries an
 * `:agencyId` param it must match the caller's own agency. By default the agency must also be
 * approved by a Super Admin.
 */
export function requireAgencyMembership(opts: { requireApproved?: boolean } = {}): RequestHandler {
  const requireApproved = opts.requireApproved ?? true;
  return (req: Request, _res: Response, next: NextFunction) => {
    const p = principalOf(req);
    const m = p.membership;
    if (!m || m.status !== 'ACTIVE') {
      return next(AppError.forbidden('Agency membership required', ErrorCode.AGENCY_MEMBERSHIP_REQUIRED));
    }
    const paramAgency = req.params?.agencyId;
    if (paramAgency && paramAgency !== m.agencyId) return next(AppError.forbidden());
    if (requireApproved && m.agencyStatus !== 'APPROVED') {
      return next(
        AppError.forbidden('Your agency is awaiting verification by the TTMS team', ErrorCode.AGENCY_NOT_APPROVED),
      );
    }
    req.agency = { id: m.agencyId, role: m.role };
    next();
  };
}
