import type { RoleName, VerificationStatus } from '@/types';

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
export const COMPANY_ROLES: RoleName[] = ['COMPANY_ADMIN', 'COMPANY_USER'];
