import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { nextCode } from '../../lib/codes';
import { prisma } from '../../lib/prisma';
import { storage } from '../../lib/storage';
import { authenticateUser } from '../../middleware/auth';
import { requireCompany } from '../../middleware/company';
import { multipart, sendStoredFile, storeUpload, type StoredFile } from '../../middleware/upload';
import { validateRequest } from '../../middleware/validate';
import { AppError } from '../../utils/errors';
import { created, ok } from '../../utils/response';
import { audit } from '../audit/audit';
import { idParam, ids } from '../company/company.routes';
import { notify } from '../notifications/notification.service';

export const TICKET_CATEGORIES = [
  'TRANSPORTER_ISSUE',
  'DRIVER_ISSUE',
  'VEHICLE_DELAY',
  'FREIGHT_DISPUTE',
  'LOADING_PROBLEM',
  'DELIVERY_PROBLEM',
  'PAYMENT_PROBLEM',
  'OTHER',
] as const;

const ticketSchema = z
  .object({
    category: z.enum(TICKET_CATEGORIES, { errorMap: () => ({ message: 'Select a category' }) }),
    bookingId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
    subject: z.string().trim().min(5, 'Add a short subject').max(160),
    description: z.string().trim().min(20, 'Describe the issue in at least 20 characters').max(4000),
  })
  .strict();

export const supportRouter = Router();
supportRouter.use(authenticateUser, requireCompany({ permission: 'company:support:manage' }));

supportRouter.post('/tickets', multipart({ field: 'attachments', maxFiles: 5 }), async (req: Request, res: Response) => {
  const input = ticketSchema.parse(req.body ?? {});
  const { companyId, userId } = ids(req);
  if (input.bookingId && !(await prisma.booking.findFirst({ where: { id: input.bookingId, companyId }, select: { id: true } }))) {
    throw AppError.badRequest('Booking not found', undefined, [{ field: 'bookingId', message: 'Select one of your bookings' }]);
  }
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const stored: StoredFile[] = [];
  try {
    for (const f of files) stored.push(await storeUpload(f, 'support-attachments', ['pdf', 'png', 'jpeg', 'webp']));
  } catch (e) {
    await Promise.all(stored.map((s) => storage.remove(s.storageKey)));
    throw e;
  }
  const ticket = await prisma.$transaction(async (tx) => {
    const t = await tx.supportTicket.create({
      data: {
        ticketNumber: await nextCode(tx, 'ticket'),
        companyId,
        bookingId: input.bookingId,
        category: input.category,
        subject: input.subject,
        description: input.description,
        createdById: userId,
        attachments: { create: stored },
      },
      include: { attachments: true },
    });
    await audit({ action: 'support.ticket_created', entityType: 'support_ticket', entityId: t.id, companyId, actorUserId: userId, metadata: { category: t.category, attachments: stored.length }, req }, tx);
    return t;
  });
  await notify({
    companyId,
    userIds: [userId],
    type: 'SUPPORT_UPDATE',
    title: `Ticket ${ticket.ticketNumber} raised`,
    message: 'Our support team will review your complaint and update you here.',
    bookingId: ticket.bookingId,
    link: `/company/support/${ticket.id}`,
  });
  created(res, 'Complaint registered', { ticket });
});

supportRouter.get('/tickets', async (req: Request, res: Response) => {
  const status = z.enum(['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED']).optional().catch(undefined).parse(req.query.status);
  const tickets = await prisma.supportTicket.findMany({
    where: { companyId: req.company!.id, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    include: { booking: { select: { id: true, bookingCode: true } }, _count: { select: { attachments: true } } },
  });
  ok(res, 'Tickets', { tickets });
});

supportRouter.get('/tickets/:id', idParam, async (req: Request, res: Response) => {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id: String(req.params.id), companyId: req.company!.id },
    include: {
      booking: { select: { id: true, bookingCode: true, status: true } },
      attachments: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true } },
      createdBy: { select: { fullName: true } },
    },
  });
  if (!ticket) throw AppError.notFound('Ticket not found');
  ok(res, 'Ticket', { ticket });
});

supportRouter.get(
  '/tickets/:id/attachments/:attachmentId',
  validateRequest({ params: z.object({ id: z.string().uuid(), attachmentId: z.string().uuid() }) }),
  async (req: Request, res: Response) => {
    const att = await prisma.supportAttachment.findFirst({
      where: { id: String(req.params.attachmentId), ticketId: String(req.params.id), ticket: { companyId: req.company!.id } },
    });
    if (!att) throw AppError.notFound('Attachment not found');
    sendStoredFile(res, att, req.query.inline === '1');
  },
);
