import type { RoleName } from '@prisma/client';

/**
 * Single source of truth for permissions and their assignment to roles.
 * The seed script writes this into the Role / Permission / RolePermission tables;
 * at runtime permissions are always read from the database, never from the client.
 */
export const PERMISSIONS = {
  'profile:read': 'Read own profile',
  'profile:update': 'Update own profile',
  'sessions:manage': 'View and revoke own sessions',

  'agency:read': 'View own agency details and registration status',
  'agency:update': 'Update own agency details',
  'agency:members:read': 'List agency members',
  'agency:members:manage': 'Create and deactivate agency staff accounts',
  'agency:invitations:manage': 'Create and revoke driver/staff invitation codes',
  'agency:drivers:read': 'List agency drivers',
  'agency:drivers:verify': 'Approve or reject agency drivers',
  'agency:operations:access': 'Access agency operations dashboard',
  'agency:finance:access': 'Access agency finance dashboard',

  'agency:bids:manage': 'Submit offers and negotiate freight',
  'agency:fleet:manage': 'Manage tankers and availability',
  'agency:drivers:manage': 'Add drivers and manage driver logins',
  'agency:trips:manage': 'Assign tankers and drivers, manage trips',
  'agency:support:manage': 'Raise and view support tickets',
  'agency:bank:manage': 'Change payout bank details',

  'driver:self': 'Driver self-service access',
  'customer:self': 'Customer self-service access',

  'company:profile:read': 'View own company profile and documents',
  'company:profile:manage': 'Edit company profile and upload documents',
  'company:locations:manage': 'Manage saved locations',
  'company:bookings:read': 'View company bookings, offers and trips',
  'company:bookings:manage': 'Create, edit and cancel bookings',
  'company:offers:negotiate': 'Counter, accept or reject transporter offers',
  'company:payments:read': 'View payments, invoices and documents',
  'company:payments:pay': 'Initiate payments',
  'company:support:manage': 'Raise and view support tickets',

  'admin:agencies:read': 'List all agencies',
  'admin:agencies:verify': 'Approve, reject or suspend agencies',
  'admin:users:read': 'List all users',
  'admin:users:manage': 'Suspend or reactivate user accounts',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

const SELF: PermissionKey[] = ['profile:read', 'profile:update', 'sessions:manage'];

export const ROLE_PERMISSIONS: Record<RoleName, PermissionKey[]> = {
  SUPER_ADMIN: [...SELF, 'admin:agencies:read', 'admin:agencies:verify', 'admin:users:read', 'admin:users:manage'],
  AGENCY_OWNER: [
    ...SELF,
    'agency:read',
    'agency:update',
    'agency:members:read',
    'agency:members:manage',
    'agency:invitations:manage',
    'agency:drivers:read',
    'agency:drivers:verify',
    'agency:operations:access',
    'agency:finance:access',
    'agency:bids:manage',
    'agency:fleet:manage',
    'agency:drivers:manage',
    'agency:trips:manage',
    'agency:support:manage',
    'agency:bank:manage',
  ],
  AGENCY_MANAGER: [
    ...SELF,
    'agency:read',
    'agency:members:read',
    'agency:invitations:manage',
    'agency:drivers:read',
    'agency:drivers:verify',
    'agency:operations:access',
    'agency:bids:manage',
    'agency:fleet:manage',
    'agency:drivers:manage',
    'agency:trips:manage',
    'agency:support:manage',
  ],
  DISPATCHER: [...SELF, 'agency:read', 'agency:drivers:read', 'agency:operations:access', 'agency:trips:manage', 'agency:support:manage'],
  FINANCE_MANAGER: [...SELF, 'agency:read', 'agency:finance:access', 'agency:support:manage'],
  DRIVER: [...SELF, 'driver:self'],
  CUSTOMER: [...SELF, 'customer:self'],
  COMPANY_ADMIN: [
    ...SELF,
    'company:profile:read',
    'company:profile:manage',
    'company:locations:manage',
    'company:bookings:read',
    'company:bookings:manage',
    'company:offers:negotiate',
    'company:payments:read',
    'company:payments:pay',
    'company:support:manage',
  ],
  // Future: invited company staff with a narrower default set.
  COMPANY_USER: [...SELF, 'company:profile:read', 'company:locations:manage', 'company:bookings:read', 'company:bookings:manage', 'company:support:manage'],
  // Future: platform back-office employee (no company-data permissions; admin APIs come later).
  EMPLOYEE: [...SELF],
};

export const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  SUPER_ADMIN: 'Platform administrator (created only via secure CLI)',
  AGENCY_OWNER: 'Owner of a transport agency',
  AGENCY_MANAGER: 'Agency manager',
  DISPATCHER: 'Agency dispatcher / operations',
  FINANCE_MANAGER: 'Agency finance manager',
  DRIVER: 'Tanker driver (mobile app)',
  CUSTOMER: 'Individual customer (legacy, disabled in the company-only release)',
  COMPANY_ADMIN: 'Administrator of a company booking oil tankers',
  COMPANY_USER: 'Company staff member (future)',
  EMPLOYEE: 'Platform employee (permissions come from the assigned employee role)',
};

/** Roles that belong to the Company Portal. */
export const COMPANY_ROLES: RoleName[] = ['COMPANY_ADMIN', 'COMPANY_USER'];

/** Transporter Portal roles (drivers have their own sub-login). */
export const TRANSPORTER_ROLES: RoleName[] = ['AGENCY_OWNER', 'AGENCY_MANAGER', 'DISPATCHER', 'FINANCE_MANAGER'];

/** Roles that may be granted to agency staff by an agency owner. */
export const AGENCY_STAFF_ROLES = ['AGENCY_MANAGER', 'DISPATCHER', 'FINANCE_MANAGER'] as const satisfies readonly RoleName[];

/** Roles that require an agency membership. */
export const AGENCY_ROLES: RoleName[] = ['AGENCY_OWNER', 'AGENCY_MANAGER', 'DISPATCHER', 'FINANCE_MANAGER', 'DRIVER'];

/** Highest-priority role first; used to pick the landing page when a user has several roles. */
const ROLE_PRIORITY: RoleName[] = [
  'SUPER_ADMIN',
  'EMPLOYEE',
  'COMPANY_ADMIN',
  'COMPANY_USER',
  'AGENCY_OWNER',
  'AGENCY_MANAGER',
  'DISPATCHER',
  'FINANCE_MANAGER',
  'DRIVER',
  'CUSTOMER',
];

export const ROLE_HOME: Record<RoleName, string> = {
  SUPER_ADMIN: '/admin/dashboard',
  AGENCY_OWNER: '/agency/dashboard',
  AGENCY_MANAGER: '/agency/dashboard',
  DISPATCHER: '/agency/operations',
  FINANCE_MANAGER: '/finance/dashboard',
  DRIVER: '/driver/app',
  CUSTOMER: '/customer/dashboard',
  COMPANY_ADMIN: '/company/dashboard',
  COMPANY_USER: '/company/dashboard',
  EMPLOYEE: '/admin/dashboard',
};

export function primaryRole(roles: RoleName[]): RoleName | null {
  return ROLE_PRIORITY.find((r) => roles.includes(r)) ?? null;
}
