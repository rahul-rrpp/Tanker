import type { Prisma } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateUser } from '../../middleware/auth';
import { requireCompany } from '../../middleware/company';
import { validateRequest } from '../../middleware/validate';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/errors';
import { ok } from '../../utils/response';
import { idParam } from '../company/company.routes';
import { DEFAULT_PREFERENCES, mergePreferences, NOTIFICATION_CATEGORIES } from './notification.service';

export const notificationsRouter = Router();
// Rows are always filtered by the caller's own user id. Company users keep the suspended-company guard.
notificationsRouter.use(authenticateUser, (req, res, next) => {
  const p = req.auth!.principal;
  if (p.company || !(p.membership || p.driver || p.employee)) return requireCompany()(req, res, next);
  next();
});

const uid = (req: Request) => req.auth!.principal.userId;

notificationsRouter.get(
  '/',
  validateRequest({ query: z.object({ unread: z.enum(['true', 'false']).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }) }),
  async (req: Request, res: Response) => {
    const q = res.locals.query as { unread?: string; page: number; pageSize: number };
    const where = { userId: uid(req), ...(q.unread === 'true' ? { readAt: null } : {}) };
    const [total, unread, items] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: uid(req), readAt: null } }),
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    ok(res, 'Notifications', { total, unread, page: q.page, pageSize: q.pageSize, items });
  },
);

notificationsRouter.get('/unread-count', async (req: Request, res: Response) => {
  ok(res, 'Unread', { unread: await prisma.notification.count({ where: { userId: uid(req), readAt: null } }) });
});

notificationsRouter.put('/read-all', async (req: Request, res: Response) => {
  const r = await prisma.notification.updateMany({ where: { userId: uid(req), readAt: null }, data: { readAt: new Date() } });
  ok(res, 'All notifications marked as read', { updated: r.count });
});

notificationsRouter.put('/:id/read', idParam, async (req: Request, res: Response) => {
  const r = await prisma.notification.updateMany({ where: { id: String(req.params.id), userId: uid(req) }, data: { readAt: new Date() } });
  if (r.count === 0) throw AppError.notFound('Notification not found');
  ok(res, 'Marked as read', null);
});

const channelPrefs = z.object({ inApp: z.boolean(), sms: z.boolean(), whatsapp: z.boolean(), email: z.boolean() }).strict();
const prefsSchema = z.object(
  Object.fromEntries(Object.keys(NOTIFICATION_CATEGORIES).map((k) => [k, channelPrefs.optional()])) as Record<keyof typeof NOTIFICATION_CATEGORIES, z.ZodOptional<typeof channelPrefs>>,
).strict();

notificationsRouter.get('/preferences', async (req: Request, res: Response) => {
  const row = await prisma.notificationPreference.findUnique({ where: { userId: uid(req) } });
  ok(res, 'Preferences', {
    preferences: mergePreferences(row?.preferences),
    defaults: DEFAULT_PREFERENCES,
    channels: { inApp: 'active', sms: 'coming soon', whatsapp: 'coming soon', email: 'coming soon' },
  });
});

notificationsRouter.put('/preferences', validateRequest({ body: z.object({ preferences: prefsSchema }).strict() }), async (req: Request, res: Response) => {
  const merged = mergePreferences(req.body.preferences);
  await prisma.notificationPreference.upsert({ where: { userId: uid(req) }, update: { preferences: merged as unknown as Prisma.InputJsonObject }, create: { userId: uid(req), preferences: merged as unknown as Prisma.InputJsonObject } });
  ok(res, 'Preferences saved', { preferences: merged });
});
