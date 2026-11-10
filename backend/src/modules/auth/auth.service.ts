import type { RoleName, User } from '@prisma/client';
import { env } from '../../config/env';
import { hasAdminRole, hasCompanyRole, hasDriverRole, hasTransporterRole, isAllPortals, portalEnabled, rolesAllowed, type Portal } from '../../config/portals';
import { nextCode } from '../../lib/codes';
import { prisma, type Tx } from '../../lib/prisma';
import { encryptField, hmac, normaliseInvitationCode } from '../../utils/crypto';
import { AppError, ErrorCode } from '../../utils/errors';
import { classifyIdentifier } from '../../utils/validators';
import { consumeVerificationToken, sendOtp, verifyAndConsumeOtp } from '../otp/otp.service';
import { notify } from '../notifications/notification.service';
import { audit as businessAudit } from '../audit/audit';
import { writeAudit } from './audit.service';
import type { RequestContext } from './context';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password.service';
import { loadPrincipal, publicUser, resolveRedirect, type PublicUser } from './principal';
import { createSession, revokeAllUserSessions, rotateRefreshToken, type IssuedTokens } from './token.service';
import type { RegisterAgencyInput, RegisterCompanyInput, RegisterCustomerInput, RegisterDriverInput, RegisterSimpleInput, RegisterTransporterInput } from './auth.schemas';

export interface AuthResult {
  tokens: IssuedTokens;
  user: PublicUser;
  redirectTo: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function roleId(tx: Tx, name: RoleName): Promise<string> {
  const role = await tx.role.findUnique({ where: { name }, select: { id: true } });
  if (!role) throw new Error(`Role ${name} is not seeded. Run "npm run db:seed".`);
  return role.id;
}

async function assertIdentityAvailable(phone: string, email?: string) {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ phone }, ...(email ? [{ email }] : [])] },
    select: { phone: true, email: true },
  });
  if (existing?.phone === phone) throw AppError.conflict('This mobile number is already registered', ErrorCode.PHONE_ALREADY_REGISTERED);
  if (email && existing?.email === email) throw AppError.conflict('This email is already registered', ErrorCode.EMAIL_ALREADY_REGISTERED);
}

/** Consumes the phone (and, when required/provided, email) verification for a registration. */
async function consumeRegistrationVerifications(
  tx: Tx,
  input: { phone: string; email?: string; phoneVerificationToken: string; emailVerificationToken?: string },
): Promise<{ isEmailVerified: boolean }> {
  await consumeVerificationToken(tx, input.phoneVerificationToken, {
    destination: input.phone,
    purpose: 'REGISTRATION',
    channel: 'SMS',
  });
  if (input.email && input.emailVerificationToken) {
    await consumeVerificationToken(tx, input.emailVerificationToken, {
      destination: input.email,
      purpose: 'REGISTRATION',
      channel: 'EMAIL',
    });
    return { isEmailVerified: true };
  }
  if (input.email && env.EMAIL_VERIFICATION_REQUIRED) {
    throw AppError.badRequest('Verify your email address to continue', ErrorCode.VERIFICATION_REQUIRED);
  }
  return { isEmailVerified: false };
}

export async function startSession(userId: string, ctx: RequestContext, tx?: Tx): Promise<AuthResult> {
  const tokens = await createSession(userId, ctx, tx);
  const principal = await loadPrincipal(userId);
  if (!principal) throw new Error('User disappeared during login');
  return { tokens, user: publicUser(principal), redirectTo: resolveRedirect(principal) };
}

/**
 * Release scope + tenant status checks applied at every sign-in and refresh.
 * With ENABLED_PORTALS=company only company accounts may sign in (other portals ship later).
 */
export async function assertPortalAccess(userId: string, ctx?: RequestContext, identifier?: string, portal?: Portal) {
  const p = await loadPrincipal(userId);
  if (!p) throw AppError.unauthorized('Account no longer exists', ErrorCode.INVALID_TOKEN);
  const deny = async (reason: string, error: AppError): Promise<never> => {
    if (ctx) await writeAudit({ userId, identifier, event: 'LOGIN_FAILED', success: false, failureReason: reason, ctx });
    throw error;
  };
  if (portal === 'admin') {
    // The Admin Portal is only ever for platform staff, whatever the release scope.
    if (!portalEnabled('admin') || !hasAdminRole(p.roles)) {
      await deny('NOT_ADMIN_ACCOUNT', AppError.unauthorized('Invalid credentials for the admin portal', ErrorCode.INVALID_CREDENTIALS));
    }
  } else if (portal === 'employee') {
    // Employee Portal: platform employees only, never a Super Admin, and only while actively employed.
    if (!portalEnabled('employee') || !p.roles.includes('EMPLOYEE') || p.roles.includes('SUPER_ADMIN') || !p.employee) {
      await deny('NOT_EMPLOYEE_ACCOUNT', AppError.unauthorized('Invalid mobile number/email or password', ErrorCode.INVALID_CREDENTIALS));
    }
    if (p.employee?.employmentStatus !== 'ACTIVE') {
      await deny('EMPLOYEE_NOT_ACTIVE', AppError.forbidden('Your employee access is not active. Contact HR.', ErrorCode.ACCOUNT_DEACTIVATED));
    }
  } else if (!isAllPortals()) {
    const otherPortal = (portalEnabled('transporter') && hasTransporterRole(p.roles)) || (portalEnabled('driver') && hasDriverRole(p.roles));
    if (portal === 'company' && !hasCompanyRole(p.roles) && !otherPortal) {
      await deny(
        'PORTAL_NOT_AVAILABLE',
        AppError.forbidden(
          hasAdminRole(p.roles) ? 'Administrators sign in through the admin portal.' : 'This sign-in is for registered companies. Other portals are not available yet.',
          ErrorCode.PORTAL_NOT_AVAILABLE,
        ),
      );
    }
    if (!rolesAllowed(p.roles)) {
      await deny('PORTAL_NOT_AVAILABLE', AppError.forbidden('This portal is not available yet.', ErrorCode.PORTAL_NOT_AVAILABLE));
    }
  }
  if (p.employee?.blocked) {
    await deny('EMPLOYEE_ACCESS_DISABLED', AppError.forbidden('Your admin access has been disabled. Contact your administrator.', ErrorCode.ACCOUNT_DEACTIVATED));
  }
  if (hasTransporterRole(p.roles) && p.membership?.agencyStatus === 'SUSPENDED') {
    await deny('TRANSPORTER_SUSPENDED', AppError.forbidden('Your transporter account is suspended. Contact support.', ErrorCode.TRANSPORTER_SUSPENDED));
  }
  if (hasDriverRole(p.roles) && p.driver && (!p.driver.isActive || p.driver.transporterStatus === 'SUSPENDED')) {
    await deny('DRIVER_ACCESS_DISABLED', AppError.forbidden('Your driver access is disabled. Contact your transporter.', ErrorCode.ACCOUNT_DEACTIVATED));
  }
  if (p.company?.companyStatus === 'SUSPENDED') {
    await deny('COMPANY_SUSPENDED', AppError.forbidden('Your company account is suspended. Contact support.', ErrorCode.COMPANY_SUSPENDED));
  }
  return p;
}

function assertCanSignIn(user: Pick<User, 'accountStatus'>) {
  if (user.accountStatus === 'SUSPENDED') throw AppError.forbidden('Your account has been suspended. Contact support.', ErrorCode.ACCOUNT_SUSPENDED);
  if (user.accountStatus === 'DEACTIVATED') throw AppError.forbidden('Your account has been deactivated.', ErrorCode.ACCOUNT_DEACTIVATED);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export async function registerAgency(input: RegisterAgencyInput, ctx: RequestContext): Promise<AuthResult> {
  await assertIdentityAvailable(input.phone, input.email);
  const dupAgency = await prisma.agency.findFirst({
    where: { OR: [{ panNumber: input.panNumber }, ...(input.gstNumber ? [{ gstNumber: input.gstNumber }] : [])] },
    select: { id: true },
  });
  if (dupAgency) throw AppError.conflict('An agency with this PAN/GST is already registered');

  const passwordHash = await hashPassword(input.password);

  const userId = await prisma.$transaction(async (tx) => {
    const { isEmailVerified } = await consumeRegistrationVerifications(tx, input);
    const user = await tx.user.create({
      data: {
        fullName: input.ownerName,
        phone: input.phone,
        email: input.email,
        passwordHash,
        passwordChangedAt: new Date(),
        isPhoneVerified: true,
        isEmailVerified,
        accountStatus: 'ACTIVE',
        roles: { create: { roleId: await roleId(tx, 'AGENCY_OWNER') } },
      },
    });
    const agency = await tx.agency.create({
      data: {
        companyName: input.companyName,
        ownerId: user.id,
        gstNumber: input.gstNumber ?? null,
        panNumber: input.panNumber,
        address: input.address,
        city: input.city,
        state: input.state,
        pincode: input.pincode,
        verificationStatus: 'PENDING_VERIFICATION',
        termsAcceptedAt: new Date(),
      },
    });
    await tx.agencyMember.create({ data: { agencyId: agency.id, userId: user.id, role: 'AGENCY_OWNER' } });
    return user.id;
  });

  await writeAudit({ userId, identifier: input.phone, event: 'REGISTERED', success: true, ctx });
  return startSession(userId, ctx);
}

export async function registerDriver(input: RegisterDriverInput, ctx: RequestContext): Promise<AuthResult> {
  await assertIdentityAvailable(input.phone, input.email);
  if (await prisma.driver.findUnique({ where: { licenceNumber: input.licenceNumber }, select: { id: true } })) {
    throw AppError.conflict('This driving licence is already registered');
  }

  const codeHash = hmac(env.OTP_HASH_SECRET, normaliseInvitationCode(input.invitationCode));
  const invitation = await prisma.agencyInvitation.findUnique({
    where: { codeHash },
    include: { agency: { select: { id: true, verificationStatus: true } } },
  });
  // Only DRIVER invitations are accepted here, so this flow can never create agency owners/staff.
  if (
    !invitation ||
    invitation.role !== 'DRIVER' ||
    invitation.revokedAt ||
    invitation.expiresAt.getTime() <= Date.now() ||
    invitation.usedCount >= invitation.maxUses ||
    invitation.agency.verificationStatus !== 'APPROVED'
  ) {
    throw AppError.badRequest('This invitation code is invalid or has expired', ErrorCode.INVALID_INVITATION);
  }

  const passwordHash = input.password ? await hashPassword(input.password) : null;

  const userId = await prisma.$transaction(async (tx) => {
    const claimed = await tx.agencyInvitation.updateMany({
      where: { id: invitation.id, revokedAt: null, usedCount: { lt: invitation.maxUses } },
      data: { usedCount: { increment: 1 } },
    });
    if (claimed.count !== 1) throw AppError.badRequest('This invitation code has already been used', ErrorCode.INVALID_INVITATION);

    const { isEmailVerified } = await consumeRegistrationVerifications(tx, input);
    const user = await tx.user.create({
      data: {
        fullName: input.fullName,
        phone: input.phone,
        email: input.email ?? null,
        passwordHash,
        passwordChangedAt: passwordHash ? new Date() : null,
        isPhoneVerified: true,
        isEmailVerified,
        accountStatus: 'ACTIVE',
        roles: { create: { roleId: await roleId(tx, 'DRIVER') } },
      },
    });
    await tx.driver.create({
      data: {
        userId: user.id,
        agencyId: invitation.agencyId,
        licenceNumber: input.licenceNumber,
        licenceType: input.licenceType,
        licenceExpiry: input.licenceExpiry,
        verificationStatus: 'PENDING_VERIFICATION',
      },
    });
    await tx.agencyMember.create({ data: { agencyId: invitation.agencyId, userId: user.id, role: 'DRIVER' } });
    return user.id;
  });

  await writeAudit({ userId, identifier: input.phone, event: 'REGISTERED', success: true, ctx });
  return startSession(userId, ctx);
}

export async function registerCustomer(input: RegisterCustomerInput, ctx: RequestContext): Promise<AuthResult> {
  await assertIdentityAvailable(input.phone, input.email);
  const passwordHash = input.password ? await hashPassword(input.password) : null;

  const userId = await prisma.$transaction(async (tx) => {
    const { isEmailVerified } = await consumeRegistrationVerifications(tx, input);
    const user = await tx.user.create({
      data: {
        fullName: input.fullName,
        phone: input.phone,
        email: input.email ?? null,
        passwordHash,
        passwordChangedAt: passwordHash ? new Date() : null,
        isPhoneVerified: true,
        isEmailVerified,
        accountStatus: 'ACTIVE', // phone verified via OTP before the account is created
        roles: { create: { roleId: await roleId(tx, 'CUSTOMER') } },
      },
    });
    await tx.customer.create({
      data: {
        userId: user.id,
        customerType: input.customerType,
        businessName: input.customerType === 'BUSINESS' ? input.businessName : null,
        gstNumber: input.customerType === 'BUSINESS' ? (input.gstNumber ?? null) : null,
        city: input.city,
        state: input.state,
      },
    });
    return user.id;
  });

  await writeAudit({ userId, identifier: input.phone, event: 'REGISTERED', success: true, ctx });
  return startSession(userId, ctx);
}

/** Simple signup: name + mobile + password. The phone is not OTP-verified, so isPhoneVerified stays false. */
export async function registerSimple(input: RegisterSimpleInput, ctx: RequestContext): Promise<AuthResult> {
  await assertIdentityAvailable(input.phone);
  const passwordHash = await hashPassword(input.password);
  const customerRole = await roleId(prisma, 'CUSTOMER');

  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      phone: input.phone,
      passwordHash,
      passwordChangedAt: new Date(),
      isPhoneVerified: false,
      accountStatus: 'ACTIVE',
      roles: { create: { roleId: customerRole } },
      customer: { create: { customerType: 'INDIVIDUAL' } },
    },
  });

  await writeAudit({ userId: user.id, identifier: input.phone, event: 'REGISTERED', success: true, ctx });
  return startSession(user.id, ctx);
}

/** Public OTP send used during registration. Refuses numbers/emails that already have an account. */
export async function sendRegistrationOtp(input: { destination: string; channel: 'SMS' | 'EMAIL' }, ip: string | null) {
  if (input.channel === 'SMS') await assertIdentityAvailable(input.destination);
  else await assertIdentityAvailable('__none__', input.destination);
  return sendOtp({ destination: input.destination, channel: input.channel, purpose: 'REGISTRATION', ip });
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

const INVALID_CREDENTIALS = () => AppError.unauthorized('Invalid mobile number/email or password', ErrorCode.INVALID_CREDENTIALS);

/**
 * Verifies identifier + password with lockout, account status and portal checks, without starting a
 * session. Used directly by the admin portal (which adds a second factor) and by loginWithPassword.
 */
export async function verifyPasswordLogin(input: { identifier: string; password: string }, ctx: RequestContext, portal: Portal) {
  const id = classifyIdentifier(input.identifier);
  const user = id
    ? await prisma.user.findUnique({ where: id.type === 'email' ? { email: id.value } : { phone: id.value } })
    : null;

  const audit = (success: boolean, failureReason?: string, userId?: string) =>
    writeAudit({ userId, identifier: id?.value ?? input.identifier.slice(0, 254), event: success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED', method: 'PASSWORD', success, failureReason, ctx });

  if (!user || !user.passwordHash) {
    await burnPasswordCheck(input.password);
    await audit(false, user ? 'NO_PASSWORD_SET' : 'UNKNOWN_IDENTIFIER', user?.id);
    throw INVALID_CREDENTIALS();
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await audit(false, 'ACCOUNT_LOCKED', user.id);
    const retryAfterSeconds = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
    throw new AppError(423, ErrorCode.ACCOUNT_LOCKED, 'Too many failed attempts. Account temporarily locked.', { retryAfterSeconds });
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    const updated = await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: { increment: 1 } }, select: { failedLoginAttempts: true } });
    if (updated.failedLoginAttempts >= env.MAX_FAILED_LOGINS) {
      await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() + env.ACCOUNT_LOCK_DURATION * 1000), failedLoginAttempts: 0 } });
      await writeAudit({ userId: user.id, identifier: id?.value, event: 'ACCOUNT_LOCKED', method: 'PASSWORD', success: false, ctx });
    }
    await audit(false, 'BAD_PASSWORD', user.id);
    throw INVALID_CREDENTIALS();
  }
  try {
    assertCanSignIn(user);
  } catch (e) {
    await audit(false, user.accountStatus, user.id);
    throw e;
  }
  await assertPortalAccess(user.id, ctx, id?.value, portal);
  return { user, identifier: id?.value ?? input.identifier };
}

export async function loginEmployee(input: { identifier: string; password: string }, ctx: RequestContext): Promise<AuthResult> {
  const { user, identifier } = await verifyPasswordLogin(input, ctx, 'employee');
  await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await writeAudit({ userId: user.id, identifier, event: 'LOGIN_SUCCESS', method: 'PASSWORD', success: true, ctx });
  return startSession(user.id, ctx);
}

export async function loginWithPassword(
  input: { identifier: string; password: string },
  ctx: RequestContext,
): Promise<AuthResult> {
  if (!isAllPortals()) {
    const { user, identifier } = await verifyPasswordLogin(input, ctx, 'company');
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await writeAudit({ userId: user.id, identifier, event: 'LOGIN_SUCCESS', method: 'PASSWORD', success: true, ctx });
    return startSession(user.id, ctx);
  }
  const id = classifyIdentifier(input.identifier);
  const user = id
    ? await prisma.user.findUnique({ where: id.type === 'email' ? { email: id.value } : { phone: id.value } })
    : null;

  const audit = (success: boolean, failureReason?: string, userId?: string) =>
    writeAudit({ userId, identifier: id?.value ?? input.identifier.slice(0, 254), event: success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED', method: 'PASSWORD', success, failureReason, ctx });

  if (!user || !user.passwordHash) {
    await burnPasswordCheck(input.password);
    await audit(false, user ? 'NO_PASSWORD_SET' : 'UNKNOWN_IDENTIFIER', user?.id);
    throw INVALID_CREDENTIALS();
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await audit(false, 'ACCOUNT_LOCKED', user.id);
    const retryAfterSeconds = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
    throw new AppError(423, ErrorCode.ACCOUNT_LOCKED, 'Too many failed attempts. Account temporarily locked.', { retryAfterSeconds });
  }

  if (!(await verifyPassword(user.passwordHash, input.password))) {
    // Atomic increment so concurrent guesses are all counted.
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    if (updated.failedLoginAttempts >= env.MAX_FAILED_LOGINS) {
      await prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil: new Date(Date.now() + env.ACCOUNT_LOCK_DURATION * 1000), failedLoginAttempts: 0 },
      });
      await writeAudit({ userId: user.id, identifier: id?.value, event: 'ACCOUNT_LOCKED', method: 'PASSWORD', success: false, ctx });
    }
    await audit(false, 'BAD_PASSWORD', user.id);
    throw INVALID_CREDENTIALS();
  }

  try {
    assertCanSignIn(user);
  } catch (e) {
    await audit(false, user.accountStatus, user.id);
    throw e;
  }
  await assertPortalAccess(user.id, ctx, id?.value);

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await audit(true, undefined, user.id);
  return startSession(user.id, ctx);
}

/** Sends a login OTP. Responds identically whether or not the number is registered. */
export async function sendLoginOtp(phone: string, ip: string | null) {
  const user = await prisma.user.findUnique({ where: { phone }, select: { accountStatus: true } });
  let devCode: string | undefined;
  if (user && user.accountStatus !== 'SUSPENDED' && user.accountStatus !== 'DEACTIVATED') {
    devCode = (await sendOtp({ destination: phone, channel: 'SMS', purpose: 'LOGIN', ip })).devCode;
  }
  return { expiresInSeconds: env.OTP_EXPIRY, resendAfterSeconds: env.OTP_RESEND_COOLDOWN, ...(devCode ? { devCode } : {}) };
}

export async function loginWithOtp(input: { phone: string; code: string }, ctx: RequestContext, portal: Portal = 'company'): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { phone: input.phone } });
  try {
    await verifyAndConsumeOtp(input.phone, 'LOGIN', input.code);
  } catch (e) {
    await writeAudit({ userId: user?.id, identifier: input.phone, event: 'LOGIN_FAILED', method: 'OTP', success: false, failureReason: (e as AppError).code ?? 'OTP', ctx });
    throw e;
  }
  if (!user) throw AppError.badRequest('Invalid or already used code. Request a new one.', ErrorCode.INVALID_OTP);
  try {
    assertCanSignIn(user);
  } catch (e) {
    await writeAudit({ userId: user.id, identifier: input.phone, event: 'LOGIN_FAILED', method: 'OTP', success: false, failureReason: user.accountStatus, ctx });
    throw e;
  }
  await assertPortalAccess(user.id, ctx, input.phone, portal);

  // A successful SMS OTP proves phone ownership; staff accounts created by an agency owner become active here.
  await prisma.user.update({
    where: { id: user.id },
    data: {
      isPhoneVerified: true,
      accountStatus: user.accountStatus === 'PENDING_VERIFICATION' ? 'ACTIVE' : user.accountStatus,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    },
  });
  await writeAudit({ userId: user.id, identifier: input.phone, event: 'LOGIN_SUCCESS', method: 'OTP', success: true, ctx });
  return startSession(user.id, ctx);
}

// ---------------------------------------------------------------------------
// Session refresh
// ---------------------------------------------------------------------------

export async function refreshSession(refreshToken: string, ctx: RequestContext): Promise<AuthResult> {
  const rotated = await rotateRefreshToken(refreshToken, ctx);
  const principal = await loadPrincipal(rotated.userId);
  if (!principal) throw AppError.unauthorized('Account no longer exists', ErrorCode.INVALID_TOKEN);
  try {
    assertCanSignIn(principal);
    await assertPortalAccess(principal.userId);
  } catch (e) {
    await revokeAllUserSessions(principal.userId, e instanceof AppError ? e.code.slice(0, 40) : principal.accountStatus);
    throw e;
  }
  const { userId: _ignored, ...tokens } = rotated;
  return { tokens, user: publicUser(principal), redirectTo: resolveRedirect(principal) };
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export async function changePassword(
  userId: string,
  currentFamilyId: string,
  input: { currentPassword?: string; password: string },
  ctx: RequestContext,
) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.passwordHash) {
    if (!input.currentPassword || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw AppError.badRequest('Current password is incorrect', ErrorCode.INVALID_CREDENTIALS);
    }
    if (await verifyPassword(user.passwordHash, input.password)) {
      throw AppError.badRequest('New password must be different from the current password');
    }
  }
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(input.password), passwordChangedAt: new Date() },
  });
  const revoked = await revokeAllUserSessions(userId, 'PASSWORD_CHANGED', { exceptFamilyId: currentFamilyId });
  await writeAudit({ userId, event: 'PASSWORD_CHANGED', success: true, ctx });
  return { otherSessionsRevoked: revoked };
}

export async function forgotPassword(identifier: string, ip: string | null) {
  const id = classifyIdentifier(identifier);
  let devCode: string | undefined;
  if (id) {
    const user = await prisma.user.findUnique({
      where: id.type === 'email' ? { email: id.value } : { phone: id.value },
      select: { accountStatus: true },
    });
    if (user && user.accountStatus !== 'DEACTIVATED') {
      devCode = (await sendOtp({ destination: id.value, channel: id.type === 'email' ? 'EMAIL' : 'SMS', purpose: 'PASSWORD_RESET', ip })).devCode;
    }
  }
  return { expiresInSeconds: env.OTP_EXPIRY, resendAfterSeconds: env.OTP_RESEND_COOLDOWN, ...(devCode ? { devCode } : {}) };
}

export async function resetPassword(input: { identifier: string; code: string; password: string }, ctx: RequestContext) {
  const id = classifyIdentifier(input.identifier);
  if (!id) throw AppError.badRequest('Invalid or already used code. Request a new one.', ErrorCode.INVALID_OTP);
  await verifyAndConsumeOtp(id.value, 'PASSWORD_RESET', input.code);
  const user = await prisma.user.findUnique({ where: id.type === 'email' ? { email: id.value } : { phone: id.value } });
  if (!user) throw AppError.badRequest('Invalid or already used code. Request a new one.', ErrorCode.INVALID_OTP);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(input.password),
      passwordChangedAt: new Date(),
      failedLoginAttempts: 0,
      lockedUntil: null,
      ...(id.type === 'email' ? { isEmailVerified: true } : { isPhoneVerified: true }),
    },
  });
  await revokeAllUserSessions(user.id, 'PASSWORD_RESET');
  await writeAudit({ userId: user.id, identifier: id.value, event: 'PASSWORD_RESET', success: true, ctx });
}

/** Revokes one of the caller's own sessions (tenant-safe: filtered by userId). */
export async function revokeOwnSession(userId: string, familyId: string): Promise<boolean> {
  const result = await prisma.refreshSession.updateMany({
    where: { userId, familyId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'USER_REVOKED' },
  });
  return result.count > 0;
}

// ---------------------------------------------------------------------------
// Company registration (Phase 1 Company Portal)
// ---------------------------------------------------------------------------

/**
 * Registers a company and its administrator in one transaction. Both the mobile number and the email
 * must be OTP-verified first. The company starts in PENDING_VERIFICATION with a sequential company ID.
 */
/** Transporter self-registration (Module 1). Starts as PENDING_VERIFICATION; the Transporter ID comes from the database. */
export async function registerTransporter(input: RegisterTransporterInput, ctx: RequestContext) {
  await assertIdentityAvailable(input.phone, input.email);
  const dup = await prisma.agency.findFirst({ where: { OR: [{ panNumber: input.panNumber }, { gstNumber: input.gstNumber }] }, select: { id: true } });
  if (dup) throw AppError.conflict('A transporter with this PAN or GST number is already registered', ErrorCode.GST_ALREADY_REGISTERED);
  const passwordHash = await hashPassword(input.password);
  const created = await prisma.$transaction(async (tx) => {
    await consumeVerificationToken(tx, input.phoneVerificationToken, { destination: input.phone, purpose: 'REGISTRATION', channel: 'SMS' });
    await consumeVerificationToken(tx, input.emailVerificationToken, { destination: input.email, purpose: 'REGISTRATION', channel: 'EMAIL' });
    const user = await tx.user.create({
      data: { fullName: input.ownerName, phone: input.phone, email: input.email, passwordHash, passwordChangedAt: new Date(), isPhoneVerified: true, isEmailVerified: true, accountStatus: 'ACTIVE', roles: { create: { roleId: await roleId(tx, 'AGENCY_OWNER') } } },
    });
    const agency = await tx.agency.create({
      data: {
        companyName: input.companyName, ownerId: user.id, gstNumber: input.gstNumber, panNumber: input.panNumber, businessType: input.businessType,
        address: input.address, city: input.city, state: input.state, pincode: input.pincode, termsAcceptedAt: new Date(), verificationStatus: 'PENDING_VERIFICATION',
        operatingCities: input.operatingCities, serviceStates: input.operatingStates, preferredRoutes: input.preferredRoutes, declaredTankers: input.numberOfTankers,
        capacityCategories: input.capacityCategories, productCategories: input.productCategories,
        members: { create: { userId: user.id, role: 'AGENCY_OWNER' } },
        contacts: { create: { name: input.ownerName, phone: input.phone, email: input.email, isPrimary: true, designation: 'Owner / authorised person' } },
        bankAccounts: { create: { accountHolder: input.bank.accountHolder, bankName: input.bank.bankName, accountNumberEnc: encryptField(input.bank.accountNumber), accountLast4: input.bank.accountNumber.slice(-4), ifsc: input.bank.ifsc, accountType: input.bank.accountType, createdById: user.id } },
      },
    });
    await businessAudit({ action: 'transporter.registered', entityType: 'transporter', entityId: agency.id, actorType: 'TRANSPORTER', actorUserId: user.id, metadata: { transporterCode: agency.transporterCode } }, tx);
    return { userId: user.id, agency };
  });
  await writeAudit({ userId: created.userId, identifier: input.phone, event: 'REGISTERED', success: true, ctx });
  const session = await startSession(created.userId, ctx);
  return { ...session, transporter: { id: created.agency.id, transporterCode: created.agency.transporterCode, verificationStatus: created.agency.verificationStatus } };
}

export async function registerCompany(
  input: RegisterCompanyInput,
  ctx: RequestContext,
): Promise<AuthResult & { company: { id: string; companyCode: string; status: string } }> {
  await assertIdentityAvailable(input.phone, input.email);
  if (await prisma.company.findUnique({ where: { gstNumber: input.gstNumber }, select: { id: true } })) {
    throw AppError.conflict('A company with this GST number is already registered', ErrorCode.GST_ALREADY_REGISTERED);
  }
  const passwordHash = await hashPassword(input.password);

  const created = await prisma.$transaction(async (tx) => {
    await consumeVerificationToken(tx, input.phoneVerificationToken, { destination: input.phone, purpose: 'REGISTRATION', channel: 'SMS' });
    await consumeVerificationToken(tx, input.emailVerificationToken, { destination: input.email, purpose: 'REGISTRATION', channel: 'EMAIL' });
    const user = await tx.user.create({
      data: {
        fullName: input.contactPersonName,
        phone: input.phone,
        email: input.email,
        passwordHash,
        passwordChangedAt: new Date(),
        isPhoneVerified: true,
        isEmailVerified: true,
        accountStatus: 'ACTIVE',
        roles: { create: { roleId: await roleId(tx, 'COMPANY_ADMIN') } },
      },
    });
    const company = await tx.company.create({
      data: {
        companyCode: await nextCode(tx, 'company'),
        name: input.companyName,
        gstNumber: input.gstNumber,
        panNumber: input.gstNumber.slice(2, 12),
        businessType: input.businessType,
        contactPersonName: input.contactPersonName,
        contactPhone: input.phone,
        contactEmail: input.email,
        termsAcceptedAt: new Date(),
        status: 'PENDING_VERIFICATION',
        members: { create: { userId: user.id, role: 'COMPANY_ADMIN' } },
        addresses: { create: { type: 'REGISTERED', address: input.address, city: input.city, state: input.state, pincode: input.pincode } },
        contacts: { create: { name: input.contactPersonName, phone: input.phone, email: input.email, isPrimary: true, designation: 'Primary contact' } },
      },
    });
    await businessAudit(
      { action: 'company.registered', entityType: 'company', entityId: company.id, companyId: company.id, actorUserId: user.id, metadata: { companyCode: company.companyCode } },
      tx,
    );
    return { userId: user.id, company };
  });

  await writeAudit({ userId: created.userId, identifier: input.phone, event: 'REGISTERED', success: true, ctx });
  await notify({
    companyId: created.company.id,
    userIds: [created.userId],
    type: 'REGISTRATION_SUCCESSFUL',
    title: 'Welcome to TankerLink',
    message: `Your company ID is ${created.company.companyCode}. Upload your GST certificate and PAN card to complete verification.`,
    link: '/company/profile',
  });
  const session = await startSession(created.userId, ctx);
  return { ...session, company: { id: created.company.id, companyCode: created.company.companyCode, status: created.company.status } };
}

// ---------------------------------------------------------------------------
// Change mobile number / email (verified by an OTP sent to the NEW destination)
// ---------------------------------------------------------------------------

export async function sendContactChangeOtp(userId: string, input: { phone?: string; email?: string }, ip: string | null) {
  if (input.phone) {
    const taken = await prisma.user.findUnique({ where: { phone: input.phone }, select: { id: true } });
    if (taken) {
      throw AppError.conflict(taken.id === userId ? 'This is already your mobile number' : 'This mobile number is already registered', ErrorCode.PHONE_ALREADY_REGISTERED);
    }
    return sendOtp({ destination: input.phone, channel: 'SMS', purpose: 'PHONE_CHANGE', ip });
  }
  const email = input.email!;
  const taken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (taken) throw AppError.conflict(taken.id === userId ? 'This is already your email' : 'This email is already registered', ErrorCode.EMAIL_ALREADY_REGISTERED);
  return sendOtp({ destination: email, channel: 'EMAIL', purpose: 'EMAIL_CHANGE', ip });
}

export async function confirmContactChange(userId: string, input: { phone?: string; email?: string; code: string }) {
  if (input.phone) {
    const phone = input.phone;
    await verifyAndConsumeOtp(phone, 'PHONE_CHANGE', input.code);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { phone, isPhoneVerified: true } });
      const member = await tx.companyMember.findUnique({ where: { userId } });
      if (member?.role === 'COMPANY_ADMIN') await tx.company.update({ where: { id: member.companyId }, data: { contactPhone: phone } });
      await businessAudit({ action: 'account.phone_changed', entityType: 'user', entityId: userId, actorUserId: userId, companyId: member?.companyId }, tx);
    });
    return;
  }
  const email = input.email!;
  await verifyAndConsumeOtp(email, 'EMAIL_CHANGE', input.code);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { email, isEmailVerified: true } });
    const member = await tx.companyMember.findUnique({ where: { userId } });
    if (member?.role === 'COMPANY_ADMIN') await tx.company.update({ where: { id: member.companyId }, data: { contactEmail: email } });
    await businessAudit({ action: 'account.email_changed', entityType: 'user', entityId: userId, actorUserId: userId, companyId: member?.companyId }, tx);
  });
}

export async function loginHistory(userId: string, limit = 50) {
  return prisma.loginAudit.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, event: true, method: true, success: true, failureReason: true, clientType: true, ipAddress: true, userAgent: true, createdAt: true },
  });
}
