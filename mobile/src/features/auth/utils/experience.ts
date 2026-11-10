import { COMPANY_ROLES, TRANSPORTER_ROLES } from '@/constants/roles';
import type { AuthUser, Experience } from '@/types';

/** Which app experience a user gets. Company first, then transporter, then driver, mirroring the web portals. */
export function experienceOf(user: AuthUser): Experience {
  if (user.company && user.roles.some((r) => COMPANY_ROLES.includes(r))) return 'company';
  if (user.agency && user.roles.some((r) => TRANSPORTER_ROLES.includes(r))) return 'transporter';
  if (user.roles.includes('DRIVER')) return 'driver';
  return 'other';
}

/**
 * Mobile landing route, derived from backend-provided roles. Unverified transporters and drivers still get
 * their app (to finish their profile or see assignments); the backend decides what they may do.
 */
export function homeRouteFor(user: AuthUser): '/company' | '/transporter' | '/driver' | '/profile' {
  const e = experienceOf(user);
  return e === 'other' ? '/profile' : (`/${e}` as '/company' | '/transporter' | '/driver');
}
