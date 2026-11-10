import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateUser, authorizePermissions } from '../../middleware/auth';
import { otpLimiter } from '../../middleware/rateLimit';
import { validateRequest } from '../../middleware/validate';
import { prisma } from '../../lib/prisma';
import { AppError, ErrorCode } from '../../utils/errors';
import { ok } from '../../utils/response';
import { fullNameSchema, optionalEmailSchema, optionalGstSchema, otpCodeSchema } from '../../utils/validators';
import { sendOtp, verifyAndConsumeOtp } from '../otp/otp.service';
import { loadPrincipal, publicUser } from '../auth/principal';

export const usersRouter = Router();
usersRouter.use(authenticateUser);

async function getProfile(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      createdAt: true,
      lastLoginAt: true,
      passwordHash: true,
      driver: {
        select: { id: true, licenceNumber: true, licenceType: true, licenceExpiry: true, verificationStatus: true, agency: { select: { id: true, companyName: true } } },
      },
      customer: { select: { id: true, customerType: true, businessName: true, gstNumber: true, city: true, state: true } },
      ownedAgency: {
        select: { id: true, companyName: true, gstNumber: true, panNumber: true, address: true, city: true, state: true, pincode: true, verificationStatus: true },
      },
    },
  });
  const principal = (await loadPrincipal(userId))!;
  const { passwordHash, ...rest } = user;
  return { ...publicUser(principal), hasPassword: Boolean(passwordHash), createdAt: rest.createdAt, lastLoginAt: rest.lastLoginAt, driver: rest.driver, customer: rest.customer, agencyDetails: rest.ownedAgency };
}

usersRouter.get('/profile', authorizePermissions('profile:read'), async (req: Request, res: Response) => {
  return ok(res, 'Profile', { profile: await getProfile(req.auth!.principal.userId) });
});

const updateProfileSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    email: optionalEmailSchema,
    customer: z
      .object({
        businessName: z.string().trim().min(2).max(160).optional(),
        gstNumber: optionalGstSchema,
        city: z.string().trim().min(2).max(80).optional(),
        state: z.string().trim().min(2).max(80).optional(),
      })
      .strict()
      .optional(),
  })
  .strict(); // phone, roles, status and agency can never be changed through this endpoint

usersRouter.patch(
  '/profile',
  authorizePermissions('profile:update'),
  validateRequest({ body: updateProfileSchema }),
  async (req: Request, res: Response) => {
    const p = req.auth!.principal;
    const body = req.body as z.infer<typeof updateProfileSchema>;
    const emailChanged = body.email !== undefined && body.email !== p.email;
    if (emailChanged && body.email) {
      const taken = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
      if (taken) throw AppError.conflict('This email is already registered', ErrorCode.EMAIL_ALREADY_REGISTERED);
    }
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: p.userId },
        data: {
          ...(body.fullName ? { fullName: body.fullName } : {}),
          ...(emailChanged ? { email: body.email ?? null, isEmailVerified: false } : {}),
        },
      });
      if (body.customer) {
        const customer = await tx.customer.findUnique({ where: { userId: p.userId } });
        if (!customer) throw AppError.forbidden('Customer details can only be updated by customers');
        if (customer.customerType === 'INDIVIDUAL' && (body.customer.businessName || body.customer.gstNumber)) {
          throw AppError.badRequest('Business details apply to business customers only');
        }
        await tx.customer.update({ where: { userId: p.userId }, data: body.customer });
      }
    });
    return ok(res, 'Profile updated', { profile: await getProfile(p.userId) });
  },
);

// Email verification for an email added after signup.
usersRouter.post('/email/send-otp', otpLimiter, async (req: Request, res: Response) => {
  const p = req.auth!.principal;
  if (!p.email) throw AppError.badRequest('Add an email address to your profile first');
  if (p.isEmailVerified) throw AppError.badRequest('Email is already verified');
  return ok(res, 'Verification code sent', await sendOtp({ destination: p.email, channel: 'EMAIL', purpose: 'EMAIL_VERIFICATION', ip: req.ip }));
});

usersRouter.post('/email/verify', otpLimiter, validateRequest({ body: z.object({ code: otpCodeSchema }) }), async (req: Request, res: Response) => {
  const p = req.auth!.principal;
  if (!p.email) throw AppError.badRequest('Add an email address to your profile first');
  await verifyAndConsumeOtp(p.email, 'EMAIL_VERIFICATION', req.body.code);
  await prisma.user.update({ where: { id: p.userId }, data: { isEmailVerified: true } });
  return ok(res, 'Email verified', { profile: await getProfile(p.userId) });
});
