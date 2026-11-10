import type { CompanyStatus } from '@prisma/client';
import type { RequestHandler } from 'express';
import { COMPANY_ROLES, type PermissionKey } from '../config/rbac';
import { AppError, ErrorCode } from '../utils/errors';
import { getSettings } from '../modules/settings/settings.service';

/**
 * Company tenant guard. Resolves the caller's company from the database-backed principal (never from
 * client input) and exposes it as req.company. Every company query MUST filter by req.company.id.
 *
 *  - SUSPENDED companies are blocked entirely.
 *  - `bookable` additionally requires a company that may create bookings (REJECTED never; PENDING only
 *    when the platform setting allowPendingCompanyBookings is on).
 */
export function requireCompany(opts: { permission?: PermissionKey; bookable?: boolean } = {}): RequestHandler {
  return async (req, _res, next) => {
    const p = req.auth?.principal;
    if (!p) return next(AppError.unauthorized());
    if (!p.company || !p.company.isActive || !p.roles.some((r) => COMPANY_ROLES.includes(r))) {
      return next(AppError.forbidden('A company account is required', ErrorCode.COMPANY_REQUIRED));
    }
    if (p.company.companyStatus === 'SUSPENDED') {
      return next(AppError.forbidden('Your company account is suspended. Contact support.', ErrorCode.COMPANY_SUSPENDED));
    }
    if (opts.permission && !p.permissions.includes(opts.permission)) return next(AppError.forbidden());
    if (opts.bookable) {
      try {
        await assertCanBook(p.company.companyStatus);
      } catch (e) {
        return next(e);
      }
    }
    req.company = { id: p.company.companyId, code: p.company.companyCode, status: p.company.companyStatus, role: p.company.role };
    next();
  };
}

export async function assertCanBook(status: CompanyStatus) {
  if (status === 'VERIFIED') return;
  if (status === 'REJECTED') {
    throw AppError.forbidden('Your company verification was rejected. Update your documents to continue booking.', ErrorCode.COMPANY_NOT_ELIGIBLE);
  }
  if (status === 'PENDING_VERIFICATION' && !(await getSettings()).allowPendingCompanyBookings) {
    throw AppError.forbidden('Bookings are available once your company is verified.', ErrorCode.COMPANY_NOT_ELIGIBLE);
  }
}
