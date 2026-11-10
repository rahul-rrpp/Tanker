import { Prisma, type PricingRule } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { round2, roundTo10 } from '../../lib/money';
import { getSettings } from '../settings/settings.service';

export interface EstimateInput {
  distanceKm: number;
  capacityKl: number;
  productId: string;
  tankerTypeId?: string | null;
  originState?: string | null;
  destState?: string | null;
  numberOfTankers: number;
}

export interface FreightEstimate {
  ruleId: string | null;
  ruleName: string;
  ratePerKm: Prisma.Decimal;
  minimumFreight: Prisma.Decimal;
  perTankerFreight: Prisma.Decimal;
  additionalChargePerTanker: Prisma.Decimal;
  additionalChargeLabel: string | null;
  distanceFreight: Prisma.Decimal;
  suggestedFreight: Prisma.Decimal;
  offerMin: Prisma.Decimal;
  offerMax: Prisma.Decimal;
  disclaimer: string;
}

const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();

/** A rule applies when every field it specifies matches; unspecified fields are wildcards. */
function matchScore(rule: PricingRule, input: EstimateInput, now: Date): number | null {
  if (rule.validFrom && rule.validFrom > now) return null;
  if (rule.validTo && rule.validTo < now) return null;
  let matched = 0;
  if (rule.capacityKl !== null) {
    if (!new Prisma.Decimal(rule.capacityKl).equals(input.capacityKl)) return null;
    matched++;
  }
  if (rule.productId) {
    if (rule.productId !== input.productId) return null;
    matched++;
  }
  if (rule.tankerTypeId) {
    if (rule.tankerTypeId !== input.tankerTypeId) return null;
    matched++;
  }
  if (rule.originState) {
    if (norm(rule.originState) !== norm(input.originState)) return null;
    matched++;
  }
  if (rule.destState) {
    if (norm(rule.destState) !== norm(input.destState)) return null;
    matched++;
  }
  return rule.priority * 100 + matched;
}

/**
 * Indicative freight: max(distance x rate, minimum) per tanker x number of tankers, rounded to Rs 10.
 * This is an estimate to guide the customer's offer, not a guaranteed market price.
 */
export async function estimateFreight(input: EstimateInput): Promise<FreightEstimate> {
  const settings = await getSettings();
  const rules = await prisma.pricingRule.findMany({ where: { isActive: true } });
  const now = new Date();
  let best: { rule: PricingRule; score: number } | null = null;
  for (const rule of rules) {
    const score = matchScore(rule, input, now);
    if (score !== null && (!best || score > best.score)) best = { rule, score };
  }
  const ratePerKm = best ? new Prisma.Decimal(best.rule.ratePerKm) : new Prisma.Decimal(settings.defaultRatePerKm);
  const minimumFreight = best ? new Prisma.Decimal(best.rule.minimumFreight) : new Prisma.Decimal(settings.defaultMinimumFreight);
  const byDistance = ratePerKm.times(input.distanceKm);
  const additionalChargePerTanker = best ? new Prisma.Decimal(best.rule.additionalCharge) : new Prisma.Decimal(0);
  const distanceFreight = roundTo10(Prisma.Decimal.max(byDistance, minimumFreight));
  const perTankerFreight = distanceFreight.plus(additionalChargePerTanker);
  const suggestedFreight = perTankerFreight.times(input.numberOfTankers);
  return {
    ruleId: best?.rule.id ?? null,
    ruleName: best?.rule.name ?? 'Platform default rate',
    ratePerKm,
    minimumFreight,
    perTankerFreight,
    additionalChargePerTanker,
    additionalChargeLabel: best?.rule.additionalChargeLabel ?? null,
    distanceFreight,
    suggestedFreight,
    offerMin: round2(suggestedFreight.times(settings.offerMinPercentOfSuggested).dividedBy(100)),
    offerMax: round2(suggestedFreight.times(settings.offerMaxPercentOfSuggested).dividedBy(100)),
    disclaimer: 'Indicative estimate based on road distance and configured rates. Final freight is agreed with the transporter.',
  };
}
