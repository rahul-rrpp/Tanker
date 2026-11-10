export type RoleName =
  | 'SUPER_ADMIN'
  | 'AGENCY_OWNER'
  | 'AGENCY_MANAGER'
  | 'DISPATCHER'
  | 'FINANCE_MANAGER'
  | 'DRIVER'
  | 'CUSTOMER'
  | 'COMPANY_ADMIN'
  | 'COMPANY_USER'
  | 'EMPLOYEE';

export type VerificationStatus = 'PENDING_VERIFICATION' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
export type AccountStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export interface AuthUser {
  id: string;
  fullName: string;
  email: string | null;
  phone: string;
  roles: RoleName[];
  permissions: string[];
  accountStatus: AccountStatus;
  isPhoneVerified: boolean;
  isEmailVerified: boolean;
  agency: { id: string; companyName: string; verificationStatus: VerificationStatus; memberRole: RoleName } | null;
  driverVerificationStatus: VerificationStatus | null;
  company?: {
    id: string;
    companyCode: string;
    name: string;
    status: 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED' | 'SUSPENDED';
    statusReason: string | null;
    isDemo: boolean;
    memberRole: RoleName;
  } | null;
}

export interface AuthResponse {
  accessToken: string;
  sessionId: string;
  user: AuthUser;
  redirectTo: string;
}

export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
  error?: { code: string; details?: unknown };
}

export const ROLE_LABELS: Record<RoleName, string> = {
  SUPER_ADMIN: 'Super Admin',
  AGENCY_OWNER: 'Agency Owner',
  AGENCY_MANAGER: 'Agency Manager',
  DISPATCHER: 'Dispatcher',
  FINANCE_MANAGER: 'Finance Manager',
  DRIVER: 'Driver',
  CUSTOMER: 'Customer',
  COMPANY_ADMIN: 'Company admin',
  COMPANY_USER: 'Company user',
  EMPLOYEE: 'Employee',
};

export const STATUS_LABELS: Record<VerificationStatus, string> = {
  PENDING_VERIFICATION: 'Pending verification',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
};
