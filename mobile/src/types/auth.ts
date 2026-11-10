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

/** Which app experience a signed-in user gets. */
export type Experience = 'company' | 'transporter' | 'driver' | 'other';
