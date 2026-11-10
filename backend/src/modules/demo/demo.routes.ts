import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateUser } from '../../middleware/auth';
import { requireCompany } from '../../middleware/company';
import { validateRequest } from '../../middleware/validate';
import { ok } from '../../utils/response';
import { idParam, ids } from '../company/company.routes';
import * as demo from './demo.service';

/**
 * DEMO SIMULATOR ROUTES — only mounted behaviour when DEMO_MODE=true (404 otherwise).
 * They stand in for the future Transporter / Driver / Admin portals so the company workflow can be
 * exercised end-to-end. Everything they create is labelled as demo data.
 */
export const demoRouter = Router();
demoRouter.get('/status', (_req: Request, res: Response) => ok(res, 'Demo status', demo.demoInfo()));

demoRouter.use(authenticateUser, requireCompany(), (_req, _res, next) => {
  demo.assertDemo();
  next();
});

demoRouter.post(
  '/bookings/:id/offers',
  idParam,
  validateRequest({ body: z.object({ count: z.number().int().min(1).max(5).default(3) }).strict() }),
  async (req: Request, res: Response) => {
    const offers = await demo.simulateOffers(req.company!.id, String(req.params.id), req.body.count);
    ok(res, `${offers.length} demo offer(s) received`, { offers });
  },
);

demoRouter.post(
  '/offers/:id/respond',
  idParam,
  validateRequest({ body: z.object({ action: z.enum(['ACCEPT', 'COUNTER']) }).strict() }),
  async (req: Request, res: Response) => {
    ok(res, 'Demo transporter responded', { offer: await demo.simulateTransporterResponse(req.company!.id, String(req.params.id), req.body.action) });
  },
);

demoRouter.post('/trips/:id/advance', idParam, async (req: Request, res: Response) => {
  ok(res, 'Demo trip advanced', await demo.advanceTrip(req.company!.id, String(req.params.id)));
});

demoRouter.post('/company/verify', async (req: Request, res: Response) => {
  const { companyId, userId } = ids(req);
  await demo.simulateCompanyVerification(companyId, userId);
  ok(res, 'Company marked as verified (demo)', null);
});
