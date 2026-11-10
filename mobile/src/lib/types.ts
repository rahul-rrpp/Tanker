export type RoleName =
  | 'SUPER_ADMIN'
  | 'EMPLOYEE'
  | 'AGENCY_OWNER'
  | 'AGENCY_MANAGER'
  | 'DISPATCHER'
  | 'FINANCE_MANAGER'
  | 'DRIVER'
  | 'CUSTOMER'
  | 'COMPANY_ADMIN'
  | 'COMPANY_USER';
export type VerificationStatus = 'PENDING_VERIFICATION' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface AuthUser {
  id: string;
  fullName: string;
  email: string | null;
  phone: string;
  roles: RoleName[];
  permissions: string[];
  accountStatus: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  isPhoneVerified: boolean;
  isEmailVerified: boolean;
  agency: { id: string; companyName: string; verificationStatus: VerificationStatus; memberRole: RoleName } | null;
  driverVerificationStatus: VerificationStatus | null;
  company?: { id: string; companyCode: string; name: string; status: string; statusReason: string | null; isDemo: boolean; memberRole: RoleName } | null;
}

/** Mobile auth responses include the refresh token (X-Client-Type: mobile). */
export interface MobileAuthData {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
  user: AuthUser;
  redirectTo: string;
}

export const ROLE_LABELS: Record<RoleName, string> = {
  SUPER_ADMIN: 'Super Admin',
  EMPLOYEE: 'Employee',
  AGENCY_OWNER: 'Transporter owner',
  AGENCY_MANAGER: 'Transporter manager',
  DISPATCHER: 'Dispatcher',
  FINANCE_MANAGER: 'Finance manager',
  DRIVER: 'Driver',
  CUSTOMER: 'Customer',
  COMPANY_ADMIN: 'Company admin',
  COMPANY_USER: 'Company user',
};

export const STATUS_LABELS: Record<VerificationStatus, string> = {
  PENDING_VERIFICATION: 'Pending verification',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
};

export const TRANSPORTER_ROLES: RoleName[] = ['AGENCY_OWNER', 'AGENCY_MANAGER', 'DISPATCHER', 'FINANCE_MANAGER'];
export type Experience = 'company' | 'transporter' | 'driver' | 'other';

/** Which app experience a user gets. Company first, then transporter, then driver, mirroring the web portals. */
export function experienceOf(user: AuthUser): Experience {
  if (user.company && user.roles.some((r) => r === 'COMPANY_ADMIN' || r === 'COMPANY_USER')) return 'company';
  if (user.agency && user.roles.some((r) => TRANSPORTER_ROLES.includes(r))) return 'transporter';
  if (user.roles.includes('DRIVER')) return 'driver';
  return 'other';
}
