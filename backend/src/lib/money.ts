import { Prisma } from '@prisma/client';

export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

/** Rounds to paise using banker-safe decimal arithmetic. */
export function round2(value: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Rounds freight suggestions to the nearest Rs 10 for readability. */
export function roundTo10(value: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(value).dividedBy(10).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).times(10);
}

export const toNumber = (v: Prisma.Decimal.Value | null | undefined): number | null =>
  v === null || v === undefined ? null : new Prisma.Decimal(v).toNumber();

export const toPaise = (v: Prisma.Decimal.Value): number => new Prisma.Decimal(v).times(100).toDecimalPlaces(0).toNumber();

export function formatInr(v: Prisma.Decimal.Value): string {
  return `INR ${new Prisma.Decimal(v).toNumber().toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
