import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateUser } from '../../middleware/auth';
import { requireCompany } from '../../middleware/company';
import { ok } from '../../utils/response';
import { idParam } from '../company/company.routes';
import * as trips from './trip.service';

export const tripsRouter = Router();
tripsRouter.use(authenticateUser, requireCompany({ permission: 'company:bookings:read' }));

tripsRouter.get('/', async (req: Request, res: Response) => {
  const scope = z.enum(['active', 'completed', 'all']).catch('all').parse(req.query.scope);
  ok(res, 'Trips', { trips: await trips.listTrips(req.company!.id, { scope }) });
});

tripsRouter.get('/:id', idParam, async (req: Request, res: Response) => {
  ok(res, 'Trip', { trip: await trips.getTrip(req.company!.id, String(req.params.id)) });
});

tripsRouter.get('/:id/tracking', idParam, async (req: Request, res: Response) => {
  ok(res, 'Tracking', { tracking: await trips.getTracking(req.company!.id, String(req.params.id)) });
});
