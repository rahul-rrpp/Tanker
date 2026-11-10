import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { AGENCY_STAFF_ROLES } from '../../config/rbac';
import { prisma } from '../../lib/prisma';
import { authenticateUser, authorizePermissions, authorizeRoles, requireAgencyMembership, requireVerifiedAccount } from '../../middleware/auth';
import { validateRequest } from '../../middleware/validate';
import { generateInvitationCode, hmac } from '../../utils/crypto';
import { AppError, ErrorCode } from '../../utils/errors';
import { created, ok } from '../../utils/response';
import { fullNameSchema, optionalEmailSchema, phoneSchema } from '../../utils/validators';
import { revokeAllUserSessions } from '../auth/token.service';

export const agencyRouter = Router();
agencyRouter.use(authenticateUser);

const uuidParam = (name: string) => z.object({ [name]: z.string().uuid() });

/**
 * Registration status — visible to the agency owner even before approval.
 */
agencyRouter.get(
  '/registration-status',
  authorizeRoles('AGENCY_OWNER'),
  requireAgencyMembership({ requireApproved: false }),
  async (req: Request, res: Response) => {
    const agency = await prisma.agency.findUniqueOrThrow({
      where: { id: req.agency!.id },
      select: { id: true, companyName: true, verificationStatus: true, rejectionReason: true, verifiedAt: true, createdAt: true, city: true, state: true },
    });
    const messages: Record<string, string> = {
      PENDING_VERIFICATION: 'Your registration is under review. This usually takes 1–2 business days.',
      APPROVED: 'Your agency is verified. All features are available.',
      REJECTED: 'Your registration was not approved. See the reason below and contact support.',
      SUSPENDED: 'Your agency has been suspended. Contact support.',
    };
    return ok(res, 'Agency registration status', { agency, statusMessage: messages[agency.verificationStatus] });
  },
);

// Everything below requires an APPROVED agency and a verified account (tenant-scoped by membership).
agencyRouter.use(requireVerifiedAccount, requireAgencyMembership());

// ---- Staff --------------------------------------------------------------------------------

agencyRouter.get('/members', authorizePermissions('agency:members:read'), async (req: Request, res: Response) => {
  const members = await prisma.agencyMember.findMany({
    where: { agencyId: req.agency!.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, status: true, createdAt: true, user: { select: { id: true, fullName: true, phone: true, email: true, accountStatus: true } } },
  });
  return ok(res, 'Agency members', { members });
});

const createMemberSchema = z.object({
  fullName: fullNameSchema,
  phone: phoneSchema,
  email: optionalEmailSchema,
  role: z.enum(AGENCY_STAFF_ROLES),
});

/** Agency owner creates a staff account. The staff member activates it by signing in with a mobile OTP. */
agencyRouter.post(
  '/members',
  authorizePermissions('agency:members:manage'),
  validateRequest({ body: createMemberSchema }),
  async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof createMemberSchema>;
    const existing = await prisma.user.findFirst({ where: { OR: [{ phone: body.phone }, ...(body.email ? [{ email: body.email }] : [])] }, select: { phone: true } });
    if (existing) {
      throw existing.phone === body.phone
        ? AppError.conflict('This mobile number is already registered', ErrorCode.PHONE_ALREADY_REGISTERED)
        : AppError.conflict('This email is already registered', ErrorCode.EMAIL_ALREADY_REGISTERED);
    }
    const role = await prisma.role.findUniqueOrThrow({ where: { name: body.role } });
    const member = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          fullName: body.fullName,
          phone: body.phone,
          email: body.email ?? null,
          accountStatus: 'PENDING_VERIFICATION',
          roles: { create: { roleId: role.id } },
        },
      });
      return tx.agencyMember.create({
        data: { agencyId: req.agency!.id, userId: user.id, role: body.role },
        select: { id: true, role: true, status: true, user: { select: { id: true, fullName: true, phone: true, email: true, accountStatus: true } } },
      });
    });
    return created(res, 'Staff account created. They can sign in with an OTP sent to their mobile number.', { member });
  },
);

agencyRouter.patch(
  '/members/:memberId/status',
  authorizePermissions('agency:members:manage'),
  validateRequest({ params: uuidParam('memberId'), body: z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }) }),
  async (req: Request, res: Response) => {
    const { memberId } = res.locals.params as { memberId: string };
    // Tenant isolation: the member must belong to the caller's agency.
    const member = await prisma.agencyMember.findFirst({ where: { id: memberId, agencyId: req.agency!.id } });
    if (!member) throw AppError.notFound('Member not found');
    if (member.role === 'AGENCY_OWNER') throw AppError.forbidden('The agency owner cannot be deactivated');
    const updated = await prisma.agencyMember.update({ where: { id: member.id }, data: { status: req.body.status } });
    if (req.body.status === 'INACTIVE') await revokeAllUserSessions(member.userId, 'MEMBERSHIP_DEACTIVATED');
    return ok(res, 'Member updated', { member: updated });
  },
);

// ---- Invitations ------------------------------------------------------------------------------

const createInvitationSchema = z.object({
  maxUses: z.coerce.number().int().min(1).max(50).default(1),
  expiresInDays: z.coerce.number().int().min(1).max(30).default(7),
});

agencyRouter.post(
  '/invitations',
  authorizePermissions('agency:invitations:manage'),
  validateRequest({ body: createInvitationSchema }),
  async (req: Request, res: Response) => {
    const code = generateInvitationCode();
    const invitation = await prisma.agencyInvitation.create({
      data: {
        agencyId: req.agency!.id,
        codeHash: hmac(env.OTP_HASH_SECRET, code),
        codeHint: code.slice(-4),
        role: 'DRIVER',
        maxUses: req.body.maxUses,
        expiresAt: new Date(Date.now() + req.body.expiresInDays * 86400_000),
        createdById: req.auth!.principal.userId,
      },
      select: { id: true, codeHint: true, role: true, maxUses: true, usedCount: true, expiresAt: true, createdAt: true },
    });
    // The raw code is returned exactly once; only its hash is stored.
    return created(res, 'Invitation created. Share this code with your driver.', { invitation: { ...invitation, code } });
  },
);

agencyRouter.get('/invitations', authorizePermissions('agency:invitations:manage'), async (req: Request, res: Response) => {
  const invitations = await prisma.agencyInvitation.findMany({
    where: { agencyId: req.agency!.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, codeHint: true, role: true, maxUses: true, usedCount: true, expiresAt: true, revokedAt: true, createdAt: true },
  });
  return ok(res, 'Invitations', { invitations });
});

agencyRouter.delete(
  '/invitations/:invitationId',
  authorizePermissions('agency:invitations:manage'),
  validateRequest({ params: uuidParam('invitationId') }),
  async (req: Request, res: Response) => {
    const { invitationId } = res.locals.params as { invitationId: string };
    const result = await prisma.agencyInvitation.updateMany({
      where: { id: invitationId, agencyId: req.agency!.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) throw AppError.notFound('Invitation not found');
    return ok(res, 'Invitation revoked', null);
  },
);

// ---- Drivers ------------------------------------------------------------------------------

agencyRouter.get('/drivers', authorizePermissions('agency:drivers:read'), async (req: Request, res: Response) => {
  const drivers = await prisma.driver.findMany({
    where: { agencyId: req.agency!.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      licenceNumber: true,
      licenceType: true,
      licenceExpiry: true,
      verificationStatus: true,
      createdAt: true,
      user: { select: { id: true, fullName: true, phone: true, email: true, accountStatus: true } },
    },
  });
  return ok(res, 'Drivers', { drivers });
});

agencyRouter.patch(
  '/drivers/:driverId/verification',
  authorizePermissions('agency:drivers:verify'),
  validateRequest({ params: uuidParam('driverId'), body: z.object({ status: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED']) }) }),
  async (req: Request, res: Response) => {
    const { driverId } = res.locals.params as { driverId: string };
    // Scoped by agencyId so an agency can never act on another agency's driver (returns 404, no existence leak).
    const result = await prisma.driver.updateMany({
      where: { id: driverId, agencyId: req.agency!.id },
      data: { verificationStatus: req.body.status },
    });
    if (result.count === 0) throw AppError.notFound('Driver not found');
    const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { id: true, userId: true, verificationStatus: true } });
    if (req.body.status === 'SUSPENDED') await revokeAllUserSessions(driver.userId, 'DRIVER_SUSPENDED');
    return ok(res, 'Driver verification updated', { driver: { id: driver.id, verificationStatus: driver.verificationStatus } });
  },
);
