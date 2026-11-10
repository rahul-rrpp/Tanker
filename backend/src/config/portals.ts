import type { RoleName } from '@prisma/client';
import { env } from './env';
import { COMPANY_ROLES, TRANSPORTER_ROLES } from './rbac';

/**
 * Release scope. ENABLED_PORTALS is a comma list of: company, admin, transporter, driver, all.
 *   company     -> Company Portal sign-in (COMPANY_ADMIN / COMPANY_USER)
 *   admin       -> Admin Portal sign-in (SUPER_ADMIN / EMPLOYEE) through /admin/auth with 2FA
 *   transporter -> Transporter Portal sign-in (AGENCY_OWNER and agency staff) and self-registration
 *   driver      -> Driver sub-login (DRIVER)
 *   employee    -> Employee Portal sign-in (EMPLOYEE), without the admin 2FA route
 *   all         -> every role (automated tests, legacy screens)
 * Read on every call so the value can be changed at runtime in tests.
 */
export type Portal = 'company' | 'admin' | 'transporter' | 'driver' | 'employee';

export const ADMIN_ROLES: RoleName[] = ['SUPER_ADMIN', 'EMPLOYEE'];

export function enabledPortals(): Set<string> {
  return new Set(String(env.ENABLED_PORTALS).split(',').map((s) => s.trim()).filter(Boolean));
}

export const portalEnabled = (p: Portal | 'all') => {
  const set = enabledPortals();
  return set.has('all') || set.has(p);
};

export const isAllPortals = () => enabledPortals().has('all');

/** True only when the portal was released by name; `all` keeps the legacy landing pages. */
export const portalReleased = (p: Portal) => enabledPortals().has(p);

export const hasCompanyRole = (roles: RoleName[]) => roles.some((r) => COMPANY_ROLES.includes(r));
export const hasAdminRole = (roles: RoleName[]) => roles.some((r) => ADMIN_ROLES.includes(r));
export const hasTransporterRole = (roles: RoleName[]) => roles.some((r) => TRANSPORTER_ROLES.includes(r));
export const hasDriverRole = (roles: RoleName[]) => roles.includes('DRIVER');

/** May a session with these roles use the API at all under the current release scope? */
export function rolesAllowed(roles: RoleName[]): boolean {
  if (isAllPortals()) return true;
  return (
    (portalEnabled('company') && hasCompanyRole(roles)) ||
    (portalEnabled('admin') && hasAdminRole(roles)) ||
    (portalEnabled('transporter') && hasTransporterRole(roles)) ||
    (portalEnabled('driver') && hasDriverRole(roles)) ||
    (portalEnabled('employee') && roles.includes('EMPLOYEE'))
  );
}
