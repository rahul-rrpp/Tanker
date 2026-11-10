import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { expireStaleOffers } from './modules/offers/offer.service';
import { attachRealtime } from './lib/realtime';
import { sweepTripAlerts } from './modules/transporter/tracking.service';
import { sweepEmployeeReminders } from './modules/employee/reminders.service';
import { sweepExpiringDocuments } from './modules/transporter/alerts.service';

async function main() {
  await prisma.$connect();
  const server = createApp().listen(env.PORT, () => {
    logger.info(`TankerLink API listening on http://localhost:${env.PORT} (docs: /api/docs)`);
    if (env.OTP_PROVIDER === 'mock') logger.warn('OTP_PROVIDER=mock — codes are printed to this console, not sent. Development only.');
    if (env.DEMO_MODE) logger.warn('DEMO_MODE=true — demo simulator endpoints are enabled. Never enable for real customers.');
    if (env.PAYMENT_PROVIDER === 'mock') logger.warn('PAYMENT_PROVIDER=mock — payments use the development gateway simulator.');
  });

  attachRealtime(server);

  // Offer expiry sweep (also applied lazily whenever offers are read).
  const sweep = setInterval(() => {
    expireStaleOffers().catch((err) => logger.error({ err }, 'Offer expiry sweep failed'));
    sweepTripAlerts().catch((err) => logger.error({ err }, 'Trip alert sweep failed'));
  }, 60_000);
  sweep.unref();
  const reminders = setInterval(() => {
    sweepEmployeeReminders().catch((err) => logger.error({ err }, 'Employee reminder sweep failed'));
  }, 15 * 60_000);
  reminders.unref();
  const daily = setInterval(() => {
    sweepExpiringDocuments().catch((err) => logger.error({ err }, 'Document expiry sweep failed'));
  }, 6 * 3600_000);
  daily.unref();

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      prisma.$disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
