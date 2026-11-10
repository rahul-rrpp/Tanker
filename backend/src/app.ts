import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { openApiDocument } from './docs/openapi';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { csrfProtection } from './middleware/csrf';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimit';
import { adminRouter } from './modules/admin/admin.routes';
import { adminAuthRouter } from './modules/admin/auth.routes';
import { adminHrRouter } from './modules/admin/hr.routes';
import { adminEmployeesRouter, adminRolesRouter } from './modules/admin/people.routes';
import { employeeRouter } from './modules/employee/employee.routes';
import { adminTransporterTicketsRouter } from './modules/admin/transporter-tickets.routes';
import { agencyRouter } from './modules/agency/agency.routes';
import { authRouter } from './modules/auth/auth.routes';
import { usersRouter } from './modules/users/users.routes';
import { bookingsRouter } from './modules/bookings/booking.routes';
import { companiesRouter, locationsRouter } from './modules/company/company.routes';
import { demoRouter } from './modules/demo/demo.routes';
import { documentsRouter } from './modules/documents/document.routes';
import { catalogRouter, mapsRouter } from './modules/maps/maps.routes';
import { notificationsRouter } from './modules/notifications/notification.routes';
import { offersRouter, transportersRouter } from './modules/offers/offer.routes';
import { paymentsRouter, razorpayWebhook } from './modules/payments/payment.routes';
import { reportsRouter } from './modules/reports/report.routes';
import { supportRouter } from './modules/support/support.routes';
import { tripsRouter } from './modules/trips/trip.routes';
import { ok } from './utils/response';
import { transporterMeRouter } from './modules/transporter/profile.routes';
import { tankersRouter } from './modules/transporter/fleet.routes';
import { transporterDriversRouter } from './modules/transporter/drivers.routes';
import { marketplaceRouter, transporterBookingOffersRouter, transporterOffersRouter } from './modules/transporter/marketplace.routes';
import { transporterBookingsRouter, transporterTripsRouter, transporterTripListRouter, gpsRouter } from './modules/transporter/operations.routes';
import { driverRouter } from './modules/transporter/driver.routes';
import { transporterFinanceRouter } from './modules/transporter/finance.routes';
import { transporterSupportRouter, subscriptionRouter, servicesRouter, realtimeRouter } from './modules/transporter/business.routes';

export function createApp() {
  const app = express();

  app.set('trust proxy', /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Client-Type', 'X-Device-Info'],
      maxAge: 600,
    }),
  );
  // Payment gateway webhook needs the exact raw bytes for signature verification (no cookies, no CSRF).
  app.post('/api/v1/payments/webhook/razorpay', express.raw({ type: 'application/json', limit: '200kb' }), razorpayWebhook);
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  if (!env.isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

  app.get('/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    ok(res, 'ok', { status: 'up', time: new Date().toISOString() });
  });

  // API docs (Swagger UI needs relaxed CSP for its inline assets on this path only).
  app.get('/api/docs/openapi.json', (_req, res) => res.json(openApiDocument));
  app.use(
    '/api/docs',
    helmet({ contentSecurityPolicy: false }),
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, { customSiteTitle: 'TankerLink API' }),
  );

  const api = express.Router();
  api.use(apiLimiter);
  api.use(csrfProtection);
  api.use('/auth', authRouter);
  api.use('/users', usersRouter);
  api.use('/agency', agencyRouter);
  api.use('/admin/transporter-tickets', adminTransporterTicketsRouter);
  // Only what Admin needs to control employees. The other admin routers remain unmounted.
  api.use('/admin/auth', adminAuthRouter);
  api.use('/admin/roles', adminRolesRouter);
  api.use('/admin/employees', adminEmployeesRouter);
  api.use('/admin/hr', adminHrRouter);
  api.use('/employee', employeeRouter);
  api.use('/admin', adminRouter);
  // Company Portal (Phase 1)
  api.use('/companies', companiesRouter);
  api.use('/locations', locationsRouter);
  api.use('/catalog', catalogRouter);
  api.use('/maps', mapsRouter);
  // Transporter Portal. Routers on paths shared with the Company Portal pass non-transporter callers through.
  api.use('/transporters', transporterMeRouter, transporterDriversRouter, transporterFinanceRouter, transporterTripListRouter, subscriptionRouter);
  api.use('/tankers', tankersRouter);
  api.use('/marketplace', marketplaceRouter);
  api.use('/driver', driverRouter);
  api.use('/gps', gpsRouter);
  api.use('/realtime', realtimeRouter);
  api.use(servicesRouter);
  api.use('/bookings', transporterBookingOffersRouter, transporterBookingsRouter);
  api.use('/offers', transporterOffersRouter);
  api.use('/trips', transporterTripsRouter);
  api.use('/support', transporterSupportRouter);
  api.use('/bookings', bookingsRouter);
  api.use('/offers', offersRouter);
  api.use('/transporters', transportersRouter);
  api.use('/trips', tripsRouter);
  api.use('/payments', paymentsRouter);
  api.use('/documents', documentsRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/support', supportRouter);
  api.use('/reports', reportsRouter);
  api.use('/demo', demoRouter);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
