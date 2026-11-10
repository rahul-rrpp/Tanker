import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/errors';
import { ok } from '../../utils/response';
import { audit } from '../audit/audit';
import { notifyTransporter } from '../notifications/notification.service';
import { adminAuth, body, can, idOf } from './core';

/** Back-office handling of tickets raised from the Transporter Portal. */
export const adminTransporterTicketsRouter = Router();
adminTransporterTicketsRouter.use(...adminAuth);

adminTransporterTicketsRouter.get('/', can('complaints', 'view'), async (req: Request, res: Response) => {
  const status = z.enum(['OPEN', 'ASSIGNED', 'UNDER_REVIEW', 'UNDER_INVESTIGATION', 'AWAITING_RESPONSE', 'RESOLVED', 'CLOSED']).optional().catch(undefined).parse(req.query.status);
  const items = await prisma.supportTicket.findMany({ where: { transporterId: { not: null }, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 300, include: { transporter: { select: { companyName: true, transporterCode: true } }, booking: { select: { bookingCode: true } }, _count: { select: { attachments: true } } } });
  ok(res, 'Transporter tickets', { items });
});

adminTransporterTicketsRouter.get('/:id', can('complaints', 'view'), async (req: Request, res: Response) => {
  const ticket = await prisma.supportTicket.findFirst({ where: { id: idOf(req), transporterId: { not: null } }, include: { transporter: { select: { companyName: true, transporterCode: true } }, booking: { select: { bookingCode: true } }, attachments: { select: { id: true, fileName: true, mimeType: true } }, activities: { orderBy: { createdAt: 'asc' } } } });
  if (!ticket) throw AppError.notFound('Ticket not found');
  ok(res, 'Ticket', { ticket });
});

/** A reply is visible to the transporter unless marked internal; a status may be changed with it. */
adminTransporterTicketsRouter.post('/:id/respond', can('complaints', 'edit'), async (req: Request, res: Response) => {
  const id = idOf(req);
  const input = body(req, z.object({ message: z.string().trim().min(2).max(2000), internal: z.boolean().default(false), status: z.enum(['ASSIGNED', 'UNDER_INVESTIGATION', 'AWAITING_RESPONSE', 'RESOLVED', 'CLOSED']).optional() }).strict());
  const t = await prisma.supportTicket.findFirst({ where: { id, transporterId: { not: null } } });
  if (!t) throw AppError.notFound('Ticket not found');
  const resolving = input.status === 'RESOLVED';
  await prisma.$transaction(async (tx) => {
    await tx.complaintActivity.create({ data: { ticketId: id, type: 'NOTE', message: input.message, internal: input.internal, actorId: req.admin!.userId, fromValue: input.status ? t.status : null, toValue: input.status ?? null } });
    if (input.status) await tx.supportTicket.update({ where: { id }, data: { status: input.status, ...(resolving ? { resolvedAt: new Date(), resolutionNote: input.message.slice(0, 1000) } : {}) } });
    await audit({ action: 'complaint.responded', entityType: 'support_ticket', entityId: id, module: 'complaints', newValue: { status: input.status ?? t.status, internal: input.internal }, req }, tx);
  });
  if (!input.internal) await notifyTransporter(t.transporterId!, { type: 'SUPPORT_UPDATE', title: `Update on ticket ${t.ticketNumber}`, message: input.message, bookingId: t.bookingId, link: `/transporter/support/${id}` });
  ok(res, 'Response recorded', null);
});
