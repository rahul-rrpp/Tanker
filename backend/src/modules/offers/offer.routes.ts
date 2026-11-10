import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateUser } from '../../middleware/auth';
import { requireCompany } from '../../middleware/company';
import { validateRequest } from '../../middleware/validate';
import { ok } from '../../utils/response';
import { idParam, ids } from '../company/company.routes';
import * as offers from './offer.service';

export const offersRouter = Router();
offersRouter.use(authenticateUser);

const read = requireCompany({ permission: 'company:bookings:read' });
const negotiate = requireCompany({ permission: 'company:offers:negotiate' });

offersRouter.get('/', read, async (req: Request, res: Response) => {
  const status = z.enum(['open', 'closed', 'all']).catch('all').parse(req.query.status);
  ok(res, 'Offers', { offers: await offers.listCompanyOffers(req.company!.id, { status }) });
});

offersRouter.get('/:id', read, idParam, async (req: Request, res: Response) => {
  ok(res, 'Offer', { offer: await offers.getOffer(req.company!.id, String(req.params.id)) });
});

offersRouter.post(
  '/:id/counter',
  negotiate,
  idParam,
  validateRequest({ body: z.object({ amount: z.number().positive().max(100_000_000), message: z.string().trim().max(500).optional() }).strict() }),
  async (req: Request, res: Response) => {
    const { companyId, userId } = ids(req);
    ok(res, 'Counter-offer sent', { offer: await offers.counterOffer(companyId, userId, String(req.params.id), req.body, req) });
  },
);

offersRouter.post('/:id/accept', negotiate, idParam, async (req: Request, res: Response) => {
  const { companyId, userId } = ids(req);
  ok(res, 'Offer accepted. Booking confirmed.', await offers.acceptOffer(companyId, userId, String(req.params.id), req));
});

offersRouter.post(
  '/:id/reject',
  negotiate,
  idParam,
  validateRequest({ body: z.object({ reason: z.string().trim().max(500).optional() }).strict() }),
  async (req: Request, res: Response) => {
    const { companyId, userId } = ids(req);
    ok(res, 'Offer rejected', { offer: await offers.rejectOffer(companyId, userId, String(req.params.id), req.body, req) });
  },
);

/** Public marketplace profile of a transporter (no private data). */
export const transportersRouter = Router();
transportersRouter.get('/:id', authenticateUser, read, idParam, async (req: Request, res: Response) => {
  ok(res, 'Transporter', { transporter: await offers.transporterProfile(String(req.params.id)) });
});
