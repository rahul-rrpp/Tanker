import { Prisma, type CommissionRule } from '@prisma/client';
import { nextCodeRaw } from './codes';
import { round2 } from '../../lib/money';
import { prisma, type Tx } from '../../lib/prisma';

/**
 * Commission engine. For each booking allocation the most specific active rule (effective on the
 * confirmation date) is applied:
 *   PERCENT: commission = freight x value%      FIXED: commission = min(value, freight)
 *   transporter payable = freight - commission
 * Taxes, gateway fees and settlement deductions are handled separately (platform fee / GST live on the
 * company invoice). Rules are versioned: an edit supersedes the old version, history is kept.
 */

interface Ctx {
  freight: Prisma.Decimal;
  at: Date;
  companyCategory: string | null;
  transporterCategory: string | null;
  originState: string | null;
  destState: string | null;
  bookingType: string;
  promoCode?: string | null;
}

const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();

function score(r: CommissionRule, c: Ctx): number | null {
  if (!r.isActive || r.supersededAt) return null;
  if (r.effectiveFrom > c.at || (r.effectiveTo && r.effectiveTo < c.at)) return null;
  let matched = 0;
  const checks: [string | null, string | null | undefined][] = [
    [r.companyCategory, c.companyCategory],
    [r.transporterCategory, c.transporterCategory],
    [r.originState, c.originState],
    [r.destState, c.destState],
    [r.bookingType, c.bookingType],
    [r.promoCode, c.promoCode],
  ];
  for (const [want, have] of checks) {
    if (want === null) continue;
    if (norm(want) !== norm(have)) return null;
    matched++;
  }
  return r.priority * 100 + matched;
}

export function computeCommission(rule: Pick<CommissionRule, 'calcType' | 'value'> | null, freight: Prisma.Decimal) {
  if (!rule) return { commission: new Prisma.Decimal(0), payable: freight };
  const commission = rule.calcType === 'PERCENT' ? round2(freight.times(rule.value).dividedBy(100)) : Prisma.Decimal.min(new Prisma.Decimal(rule.value), freight);
  return { commission, payable: round2(freight.minus(commission)) };
}

export async function pickRule(c: Ctx, tx: Tx = prisma) {
  const rules = await tx.commissionRule.findMany({ where: { isActive: true, supersededAt: null } });
  let best: { r: CommissionRule; s: number } | null = null;
  for (const r of rules) {
    const s = score(r, c);
    if (s !== null && (!best || s > best.s)) best = { r, s };
  }
  return best?.r ?? null;
}

/** Creates the commission + pending settlement for one allocation (idempotent). */
export async function commissionForAllocation(allocationId: string, tx: Tx = prisma) {
  const existing = await tx.bookingCommission.findUnique({ where: { allocationId } });
  if (existing) return existing;
  const a = await tx.bookingAllocation.findUniqueOrThrow({
    where: { id: allocationId },
    include: {
      transporter: { select: { category: true } },
      booking: { select: { id: true, source: true, confirmedAt: true, createdAt: true, company: { select: { businessType: true } }, locations: { select: { type: true, state: true } } } },
    },
  });
  const rule = await pickRule(
    {
      freight: a.agreedFreight,
      at: a.createdAt,
      companyCategory: a.booking.company.businessType,
      transporterCategory: a.transporter.category,
      originState: a.booking.locations.find((l) => l.type === 'PICKUP')?.state ?? null,
      destState: a.booking.locations.find((l) => l.type === 'DELIVERY')?.state ?? null,
      bookingType: a.booking.source,
    },
    tx,
  );
  const { commission, payable } = computeCommission(rule, a.agreedFreight);
  const row = await tx.bookingCommission.create({
    data: { allocationId, bookingId: a.bookingId, transporterId: a.transporterId, ruleId: rule?.id ?? null, freightAmount: a.agreedFreight, commissionAmount: commission, transporterPayable: payable, computedAt: a.createdAt },
  });
  await tx.settlement.create({
    data: {
      settlementCode: await nextCodeRaw(tx, 'settlement_code_seq', 'STL', 7),
      transporterId: a.transporterId,
      allocationId,
      amount: payable,
      status: a.status === 'COMPLETED' ? 'PENDING' : 'ON_HOLD', // released for payout once the trip completes
      createdAt: a.createdAt,
    },
  });
  return row;
}

/** Backfills commissions for allocations that predate the engine (and any created by older code paths). */
export async function ensureCommissions() {
  const missing = await prisma.bookingAllocation.findMany({ where: { status: { not: 'CANCELLED' }, NOT: { id: { in: (await prisma.bookingCommission.findMany({ select: { allocationId: true } })).map((c) => c.allocationId) } } }, select: { id: true }, take: 500 });
  for (const m of missing) await prisma.$transaction((tx) => commissionForAllocation(m.id, tx));
  // Release settlements whose allocations have completed.
  const completed = await prisma.bookingAllocation.findMany({ where: { status: 'COMPLETED' }, select: { id: true } });
  if (completed.length) await prisma.settlement.updateMany({ where: { status: 'ON_HOLD', allocationId: { in: completed.map((c) => c.id) } }, data: { status: 'PENDING' } });
  return missing.length;
}
