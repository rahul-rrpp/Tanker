import type { AccountStatus, AgencyMemberStatus, CompanyStatus, Prisma, RoleName, VerificationStatus } from '@prisma/client';
import { portalReleased } from '../../config/portals';
import { AGENCY_ROLES, COMPANY_ROLES, ROLE_HOME, TRANSPORTER_ROLES, primaryRole } from '../../config/rbac';
import { prisma } from '../../lib/prisma';

/** Everything authorization needs about a user, always loaded from the database. */
export const principalInclude = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
  memberships: { include: { agency: { select: { id: true, companyName: true, verificationStatus: true } } } },
  driver: { select: { id: true, verificationStatus: true, agencyId: true, isActive: true, agency: { select: { verificationStatus: true } } } },
  customer: { select: { id: true, customerType: true } },
  companyMembership: {
    include: { company: { select: { id: true, companyCode: true, name: true, status: true, statusReason: true, isDemo: true } } },
  },
  employee: {
    include: {
      role: { include: { permissions: { include: { permission: { select: { key: true } } } } } },
      permissionOverrides: { include: { permission: { select: { key: true } } } },
    },
  },
} satisfies Prisma.UserInclude;

export type UserWithPrincipal = Prisma.UserGetPayload<{ include: typeof principalInclude }>;

export interface AgencyMembershipContext {
  agencyId: string;
  companyName: string;
  agencyStatus: VerificationStatus;
  role: RoleName;
  status: AgencyMemberStatus;
}

export interface CompanyContext {
  companyId: string;
  companyCode: string;
  companyName: string;
  companyStatus: CompanyStatus;
  statusReason: string | null;
  isDemo: boolean;
  role: RoleName;
  isActive: boolean;
}

export interface EmployeeContext {
  employeeId: string;
  employeeCode: string;
  roleCode: string;
  roleName: string;
  dataScope: 'ALL' | 'ASSIGNED';
  employmentStatus: string;
  /** Deactivated, not employed or login disabled. */
  blocked: boolean;
}

export interface Principal {
  userId: string;
  fullName: string;
  email: string | null;
  phone: string;
  accountStatus: AccountStatus;
  isPhoneVerified: boolean;
  isEmailVerified: boolean;
  roles: RoleName[];
  permissions: string[];
  membership: AgencyMembershipContext | null;
  driverStatus: VerificationStatus | null;
  driver: { driverId: string; transporterId: string; isActive: boolean; transporterStatus: VerificationStatus } | null;
  company: CompanyContext | null;
  employee: EmployeeContext | null;
}

export function toPrincipal(user: UserWithPrincipal): Principal {
  const roles = user.roles.map((r) => r.role.name);
  const granted = new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key)));
  // Employees: role matrix + per-employee GRANT overrides; DENY overrides always win.
  const emp = user.employee;
  const isSuper = roles.includes('SUPER_ADMIN');
  if (emp && !isSuper) {
    if (emp.role.isActive) emp.role.permissions.forEach((p) => granted.add(p.permission.key));
    emp.permissionOverrides.filter((o) => o.effect === 'GRANT').forEach((o) => granted.add(o.permission.key));
    emp.permissionOverrides.filter((o) => o.effect === 'DENY').forEach((o) => granted.delete(o.permission.key));
  }
  const permissions = [...granted].sort();
  const m = user.memberships[0];
  return {
    userId: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    accountStatus: user.accountStatus,
    isPhoneVerified: user.isPhoneVerified,
    isEmailVerified: user.isEmailVerified,
    roles,
    permissions,
    membership: m
      ? {
          agencyId: m.agency.id,
          companyName: m.agency.companyName,
          agencyStatus: m.agency.verificationStatus,
          role: m.role,
          status: m.status,
        }
      : null,
    driverStatus: user.driver?.verificationStatus ?? null,
    driver: user.driver ? { driverId: user.driver.id, transporterId: user.driver.agencyId, isActive: user.driver.isActive, transporterStatus: user.driver.agency.verificationStatus } : null,
    employee: emp
      ? {
          employeeId: emp.id,
          employeeCode: emp.employeeCode,
          roleCode: emp.role.code,
          roleName: emp.role.name,
          dataScope: emp.role.dataScope,
          employmentStatus: emp.employmentStatus,
          blocked: !isSuper && (!emp.loginEnabled || emp.employmentStatus === 'RESIGNED' || emp.employmentStatus === 'TERMINATED'),
        }
      : null,
    company: user.companyMembership
      ? {
          companyId: user.companyMembership.company.id,
          companyCode: user.companyMembership.company.companyCode,
          companyName: user.companyMembership.company.name,
          companyStatus: user.companyMembership.company.status,
          statusReason: user.companyMembership.company.statusReason,
          isDemo: user.companyMembership.company.isDemo,
          role: user.companyMembership.role,
          isActive: user.companyMembership.isActive,
        }
      : null,
  };
}

export async function loadPrincipal(userId: string): Promise<Principal | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: principalInclude });
  return user ? toPrincipal(user) : null;
}

/** Web landing route chosen by the backend; clients never decide a user's role themselves. */
export function resolveRedirect(p: Principal): string {
  const role = primaryRole(p.roles);
  if (!role) return '/unauthorized';
  if (role === 'SUPER_ADMIN' || role === 'CUSTOMER') return ROLE_HOME[role];
  if (COMPANY_ROLES.includes(role)) return p.company ? ROLE_HOME[role] : '/unauthorized';
  if (role === 'EMPLOYEE') return p.employee ? (portalReleased('employee') ? '/employee/dashboard' : '/admin/dashboard') : '/unauthorized';
  // Released portals: unverified transporters and drivers still sign in, to finish their profile.
  if (role === 'DRIVER' && portalReleased('driver')) return '/driver/dashboard';
  if (TRANSPORTER_ROLES.includes(role) && portalReleased('transporter')) return p.membership ? '/transporter/dashboard' : '/unauthorized';
  if (role === 'DRIVER') return p.driverStatus === 'APPROVED' ? ROLE_HOME.DRIVER : '/pending-verification';
  if (AGENCY_ROLES.includes(role)) {
    if (!p.membership || p.membership.agencyStatus !== 'APPROVED') return '/pending-verification';
  }
  return ROLE_HOME[role];
}

/** Public user shape returned to clients. Never includes hashes or security counters. */
export function publicUser(p: Principal) {
  return {
    id: p.userId,
    fullName: p.fullName,
    email: p.email,
    phone: p.phone,
    roles: p.roles,
    permissions: p.permissions,
    accountStatus: p.accountStatus,
    isPhoneVerified: p.isPhoneVerified,
    isEmailVerified: p.isEmailVerified,
    agency: p.membership
      ? {
          id: p.membership.agencyId,
          companyName: p.membership.companyName,
          verificationStatus: p.membership.agencyStatus,
          memberRole: p.membership.role,
        }
      : null,
    driverVerificationStatus: p.driverStatus,
    employee: p.employee ? { id: p.employee.employeeId, employeeCode: p.employee.employeeCode, roleCode: p.employee.roleCode, roleName: p.employee.roleName, dataScope: p.employee.dataScope } : null,
    company: p.company
      ? {
          id: p.company.companyId,
          companyCode: p.company.companyCode,
          name: p.company.companyName,
          status: p.company.companyStatus,
          statusReason: p.company.statusReason,
          isDemo: p.company.isDemo,
          memberRole: p.company.role,
        }
      : null,
  };
}
export type PublicUser = ReturnType<typeof publicUser>;
