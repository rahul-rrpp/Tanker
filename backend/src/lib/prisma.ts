import { Prisma, PrismaClient } from '@prisma/client';
import { env } from '../config/env';

/**
 * Money and coordinates are stored as DECIMAL in PostgreSQL. In API responses they are serialised as
 * JSON numbers (values are bounded: < 1e10 with 2-6 decimals, well inside IEEE-754 exact range).
 * All arithmetic on the server uses Prisma.Decimal, never floating point.
 */
(Prisma.Decimal.prototype as unknown as { toJSON: () => number }).toJSON = function toJSON(this: Prisma.Decimal) {
  return this.toNumber();
};

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (!env.isProduction) globalForPrisma.prisma = prisma;

export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
