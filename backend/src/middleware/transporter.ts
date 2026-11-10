import type { RequestHandler } from 'express';
import { TRANSPORTER_ROLES, type PermissionKey } from '../config/rbac';
import { AppError, ErrorCode } from '../utils/errors';

/**
 * Transporter tenant guard. The transporter comes from the database-backed principal, never from client
 * input. Every query MUST filter by req.transporter.id.
 *  - SUSPENDED transporters are blocked (`allowSuspended` keeps profile/support reachable if ever needed).
 *  - `verified` additionally requires APPROVED: live freight bidding and trip operations.
 */
export function requireTransporter(opts: { permission?: PermissionKey; verified?: boolean } = {}): RequestHandler {
  return (req, _res, next) => {
    const p = req.auth?.principal;
    if (!p) return next(AppError.unauthorized());
    const m = p.membership;
    if (!m || m.status !== 'ACTIVE' || !p.roles.some((r) => TRANSPORTER_ROLES.includes(r))) {
      return next(AppError.forbidden('A transporter account is required', ErrorCode.TRANSPORTER_REQUIRED));
    }
    if (m.agencyStatus === 'SUSPENDED') return next(AppError.forbidden('Your transporter account is suspended. Contact support.', ErrorCode.TRANSPORTER_SUSPENDED));
    if (opts.permission && !p.permissions.includes(opts.permission)) return next(AppError.forbidden());
    if (opts.verified && m.agencyStatus !== 'APPROVED') {
      return next(AppError.forbidden('This is available once your transporter account is verified.', ErrorCode.TRANSPORTER_NOT_VERIFIED));
    }
    req.transporter = { id: m.agencyId, status: m.agencyStatus, role: m.role };
    next();
  };
}

/** Driver sub-login guard. Access is limited to the driver's own record and assigned trips. */
export const requireDriver: RequestHandler = (req, _res, next) => {
  const p = req.auth?.principal;
  if (!p) return next(AppError.unauthorized());
  if (!p.driver || !p.roles.includes('DRIVER')) return next(AppError.forbidden('A driver account is required', ErrorCode.DRIVER_REQUIRED));
  if (!p.driver.isActive || p.driver.transporterStatus === 'SUSPENDED') {
    return next(AppError.forbidden('Your driver access is disabled. Contact your transporter.', ErrorCode.ACCOUNT_DEACTIVATED));
  }
  req.driver = { id: p.driver.driverId, transporterId: p.driver.transporterId };
  next();
};

/**
 * For paths shared with the Company Portal (/offers/:id, /trips/:id, /support/tickets...): continue only
 * for transporter callers, otherwise fall through to the existing company router untouched.
 */
export const transporterCallerOnly: RequestHandler = (req, _res, next) => {
  const p = req.auth?.principal;
  if (p && p.membership && p.roles.some((r) => TRANSPORTER_ROLES.includes(r))) return next();
  next('router');
};
