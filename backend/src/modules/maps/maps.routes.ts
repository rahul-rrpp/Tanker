import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { authenticateUser } from '../../middleware/auth';
import { requireCompany } from '../../middleware/company';
import { mapsLimiter } from '../../middleware/rateLimit';
import { validateRequest } from '../../middleware/validate';
import { prisma } from '../../lib/prisma';
import { ok } from '../../utils/response';
import { INDIAN_STATES } from '../../utils/gst';
import { CAPACITY_PRESETS } from '../bookings/booking.schemas';
import { getSettings } from '../settings/settings.service';
import { activeProvider, computeRoutes, placeDetails, reverseGeocode, searchPlaces } from './maps.service';

export const mapsRouter = Router();
mapsRouter.use(authenticateUser, requireCompany(), mapsLimiter);

const point = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });

mapsRouter.get('/config', (_req: Request, res: Response) => {
  const provider = activeProvider();
  ok(res, 'Maps configuration', {
    provider,
    label: provider === 'google' ? 'Google Maps Platform' : provider === 'osm' ? 'OpenStreetMap (development fallback)' : provider,
    isDevelopmentProvider: provider !== 'google',
  });
});

mapsRouter.get(
  '/places',
  validateRequest({ query: z.object({ q: z.string().trim().min(2).max(120), sessionToken: z.string().max(100).optional() }) }),
  async (_req: Request, res: Response) => {
    const { q, sessionToken } = res.locals.query as { q: string; sessionToken?: string };
    ok(res, 'Places', { suggestions: await searchPlaces(q, sessionToken) });
  },
);

mapsRouter.get(
  '/places/details',
  validateRequest({ query: z.object({ placeId: z.string().trim().min(3).max(300), sessionToken: z.string().max(100).optional() }) }),
  async (_req: Request, res: Response) => {
    const { placeId, sessionToken } = res.locals.query as { placeId: string; sessionToken?: string };
    ok(res, 'Place', { place: await placeDetails(placeId, sessionToken) });
  },
);

mapsRouter.get(
  '/reverse',
  validateRequest({ query: z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }) }),
  async (_req: Request, res: Response) => {
    const { lat, lng } = res.locals.query as { lat: number; lng: number };
    ok(res, 'Address', { place: await reverseGeocode(lat, lng) });
  },
);

mapsRouter.post('/route', validateRequest({ body: z.object({ origin: point, destination: point }).strict() }), async (req: Request, res: Response) => {
  const r = await computeRoutes({ lat: req.body.origin.latitude, lng: req.body.origin.longitude }, { lat: req.body.destination.latitude, lng: req.body.destination.longitude });
  ok(res, 'Routes', r);
});

mapsRouter.post('/distance', validateRequest({ body: z.object({ origin: point, destination: point }).strict() }), async (req: Request, res: Response) => {
  const r = await computeRoutes({ lat: req.body.origin.latitude, lng: req.body.origin.longitude }, { lat: req.body.destination.latitude, lng: req.body.destination.longitude });
  const best = r.routes[0];
  ok(res, 'Road distance', { provider: r.provider, providerLabel: r.providerLabel, distanceKm: best.distanceKm, durationMinutes: best.durationMinutes, baseDurationMinutes: best.baseDurationMinutes });
});

/** Master data for booking forms (admin-configurable in a later phase). */
export const catalogRouter = Router();
catalogRouter.get('/', authenticateUser, requireCompany(), async (_req: Request, res: Response) => {
  const [products, tankerTypes, settings] = await Promise.all([
    prisma.product.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, code: true, name: true, category: true, description: true, requiresSpecialApproval: true } }),
    prisma.tankerType.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, code: true, name: true, description: true } }),
    getSettings(),
  ]);
  ok(res, 'Catalog', {
    products,
    tankerTypes,
    capacities: CAPACITY_PRESETS,
    states: INDIAN_STATES.map((s) => s.name),
    settings: {
      offerMinPercentOfSuggested: settings.offerMinPercentOfSuggested,
      offerMaxPercentOfSuggested: settings.offerMaxPercentOfSuggested,
      offerExpiryHours: settings.offerExpiryHours,
      maxTankersPerBooking: settings.maxTankersPerBooking,
      heavyVehicleEtaFactor: settings.heavyVehicleEtaFactor,
      platformFeePercent: settings.platformFeePercent,
      gstPercent: settings.gstPercent,
      advancePercent: settings.advancePercent,
    },
    demoMode: env.DEMO_MODE && !env.isProduction,
    paymentProvider: env.PAYMENT_PROVIDER,
    mapsProvider: activeProvider(),
  });
});
