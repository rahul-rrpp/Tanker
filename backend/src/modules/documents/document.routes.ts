import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateUser } from '../../middleware/auth';
import { requireCompany } from '../../middleware/company';
import { sendStoredFile } from '../../middleware/upload';
import { validateRequest } from '../../middleware/validate';
import { ok } from '../../utils/response';
import { sendPdf } from '../bookings/booking.routes';
import { DOCUMENT_TYPES, listDocuments, resolveDocument } from './document.service';

export const documentsRouter = Router();
documentsRouter.use(authenticateUser, requireCompany({ permission: 'company:payments:read' }));

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

documentsRouter.get(
  '/',
  validateRequest({ query: z.object({ type: z.enum(DOCUMENT_TYPES).optional(), bookingId: z.string().uuid().optional(), from: date.optional(), to: date.optional() }) }),
  async (req: Request, res: Response) => {
    ok(res, 'Documents', { documents: await listDocuments(req.company!.id, res.locals.query) });
  },
);

const docId = validateRequest({ params: z.object({ id: z.string().regex(/^[A-Z_]+:[0-9a-f-]{36}$/i, 'Invalid document id') }) });

async function serve(req: Request, res: Response) {
  const doc = await resolveDocument(req.company!.id, String(req.params.id));
  const inline = req.query.inline === '1';
  if (doc.kind === 'buffer') return sendPdf(res, doc, inline);
  return sendStoredFile(res, doc, inline);
}

documentsRouter.get('/:id', docId, serve);
documentsRouter.get('/:id/download', docId, serve);
