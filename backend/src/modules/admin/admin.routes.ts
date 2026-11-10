import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticateUser, authorizePermissions, authorizeRoles } from '../../middleware/auth';
import { validateRequest } from '../../middleware/validate';
import { AppError } from '../../utils/errors';
import { ok } from '../../utils/response';
import { revokeAllUserSessions } from '../auth/token.service';

export const adminRouter = Router();
adminRouter.use(authenticateUser, authorizeRoles('SUPER_ADMIN'));

const listAgenciesQuery = z.object({
  status: z.enum(['PENDING_VERIFICATION', 'APPROVED', 'REJECTED', 'SUSPENDED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

adminRouter.get(
  '/agencies',
  authorizePermissions('admin:agencies:read'),
  validateRequest({ query: listAgenciesQuery }),
  async (_req: Request, res: Response) => {
    const q = res.locals.query as z.infer<typeof listAgenciesQuery>;
    const where = q.status ? { verificationStatus: q.status } : {};
    const [total, agencies] = await prisma.$transaction([
      prisma.agency.count({ where }),
      prisma.agency.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          companyName: true,
          gstNumber: true,
          panNumber: true,
          city: true,
          state: true,
          verificationStatus: true,
          rejectionReason: true,
          createdAt: true,
          owner: { select: { id: true, fullName: true, phone: true, email: true } },
        },
      }),
    ]);
    return ok(res, 'Agencies', { agencies, total, page: q.page, pageSize: q.pageSize });
  },
);

const verifyAgencySchema = z
  .object({ status: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED']), reason: z.string().trim().max(500).optional() })
  .refine((v) => v.status === 'APPROVED' || (v.reason && v.reason.length >= 5), {
    path: ['reason'],
    message: 'A reason is required when rejecting or suspending',
  });

adminRouter.patch(
  '/agencies/:agencyId/verification',
  authorizePermissions('admin:agencies:verify'),
  validateRequest({ params: z.object({ agencyId: z.string().uuid() }), body: verifyAgencySchema }),
  async (req: Request, res: Response) => {
    const { agencyId } = res.locals.params as { agencyId: string };
    const exists = await prisma.agency.findUnique({ where: { id: agencyId }, select: { id: true } });
    if (!exists) throw AppError.notFound('Agency not found');
    const agency = await prisma.agency.update({
      where: { id: agencyId },
      data: {
        verificationStatus: req.body.status,
        rejectionReason: req.body.status === 'APPROVED' ? null : req.body.reason,
        verifiedAt: req.body.status === 'APPROVED' ? new Date() : null,
        verifiedById: req.auth!.principal.userId,
      },
      select: { id: true, companyName: true, verificationStatus: true, rejectionReason: true, verifiedAt: true },
    });
    return ok(res, `Agency ${req.body.status.toLowerCase()}`, { agency });
  },
);

adminRouter.patch(
  '/users/:userId/status',
  authorizePermissions('admin:users:manage'),
  validateRequest({
    params: z.object({ userId: z.string().uuid() }),
    body: z.object({ accountStatus: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']) }),
  }),
  async (req: Request, res: Response) => {
    const { userId } = res.locals.params as { userId: string };
    const target = await prisma.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: true } } } });
    if (!target) throw AppError.notFound('User not found');
    if (target.roles.some((r) => r.role.name === 'SUPER_ADMIN')) {
      throw AppError.forbidden('Super Admin accounts can only be managed via the secure CLI');
    }
    await prisma.user.update({ where: { id: userId }, data: { accountStatus: req.body.accountStatus } });
    if (req.body.accountStatus !== 'ACTIVE') await revokeAllUserSessions(userId, `ACCOUNT_${req.body.accountStatus}`);
    return ok(res, 'Account status updated', { userId, accountStatus: req.body.accountStatus });
  },
);
