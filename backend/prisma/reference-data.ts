/**
 * Reference / master data required in every environment (idempotent).
 * Products, tanker types, pricing rules and platform settings. Existing rows are not overwritten,
 * so values changed later by an administrator survive re-seeding.
 */
import type { PrismaClient } from '@prisma/client';
import { SETTINGS_SCHEMA } from '../src/modules/settings/settings.service';

export const PRODUCTS = [
  { code: 'PETROL', name: 'Petrol (MS)', category: 'FUEL', description: 'Motor spirit. Class A petroleum - PESO-licensed tankers only.', sortOrder: 1 },
  { code: 'DIESEL', name: 'Diesel (HSD)', category: 'FUEL', description: 'High speed diesel. Class B petroleum.', sortOrder: 2 },
  { code: 'FURNACE_OIL', name: 'Furnace Oil', category: 'FUEL', description: 'Heavy fuel oil. Usually needs insulated / heated tankers.', sortOrder: 3 },
  { code: 'LUBRICATING_OIL', name: 'Lubricating Oil', category: 'LUBRICANT', description: 'Finished lubricants and engine oils.', sortOrder: 4 },
  { code: 'BASE_OIL', name: 'Base Oil', category: 'LUBRICANT', description: 'Group I/II/III base oils for blending.', sortOrder: 5 },
  { code: 'INDUSTRIAL_OIL', name: 'Industrial Oil', category: 'INDUSTRIAL', description: 'Hydraulic, transformer, quenching and process oils.', sortOrder: 6 },
  { code: 'OTHER_APPROVED', name: 'Other Approved Product', category: 'OTHER', description: 'Other petroleum products approved by TankerLink operations.', requiresSpecialApproval: true, sortOrder: 99 },
];

export const TANKER_TYPES = [
  { code: 'PESO_PETROLEUM', name: 'PESO-licensed petroleum tanker', description: 'Licensed under Petroleum Rules for Class A/B products.', sortOrder: 1 },
  { code: 'MS_TANKER', name: 'Mild steel tanker', description: 'General purpose for diesel, industrial and furnace oils.', sortOrder: 2 },
  { code: 'SS_TANKER', name: 'Stainless steel tanker', description: 'Contamination-free transport for lubricants and base oils.', sortOrder: 3 },
  { code: 'INSULATED_HEATED', name: 'Insulated / heated tanker', description: 'Keeps viscous products such as furnace oil pumpable.', sortOrder: 4 },
  { code: 'ALUMINIUM', name: 'Aluminium tanker', description: 'Lightweight tanker for higher payloads.', sortOrder: 5 },
];

/** Rates in Rs per km per tanker. More specific rules (higher priority) win. */
export const PRICING_RULES: { name: string; ratePerKm: number; minimumFreight: number; additionalCharge?: number; additionalChargeLabel?: string; capacityKl?: number; product?: string; tankerType?: string; originState?: string; destState?: string; priority: number }[] = [
  { name: 'Base rate - any tanker', ratePerKm: 55, minimumFreight: 8000, priority: 0 },
  { name: '10 KL tanker', ratePerKm: 42, minimumFreight: 6000, capacityKl: 10, priority: 1 },
  { name: '12 KL tanker', ratePerKm: 46, minimumFreight: 6500, capacityKl: 12, priority: 1 },
  { name: '16 KL tanker', ratePerKm: 52, minimumFreight: 7500, capacityKl: 16, priority: 1 },
  { name: '20 KL tanker', ratePerKm: 58, minimumFreight: 8500, capacityKl: 20, priority: 1 },
  { name: '24 KL tanker', ratePerKm: 64, minimumFreight: 9500, capacityKl: 24, priority: 1 },
  { name: '30 KL tanker', ratePerKm: 72, minimumFreight: 11000, capacityKl: 30, priority: 1 },
  { name: 'Heated tanker (any capacity)', ratePerKm: 74, minimumFreight: 12000, additionalCharge: 1500, additionalChargeLabel: 'Heating charge', tankerType: 'INSULATED_HEATED', priority: 2 },
  { name: 'Petrol 20 KL (hazardous class A)', ratePerKm: 63, minimumFreight: 9500, additionalCharge: 1000, additionalChargeLabel: 'Hazardous goods handling', capacityKl: 20, product: 'PETROL', priority: 3 },
  { name: 'Maharashtra to Gujarat lane, 20 KL', ratePerKm: 54, minimumFreight: 9000, capacityKl: 20, originState: 'Maharashtra', destState: 'Gujarat', priority: 4 },
];

export async function seedReferenceData(prisma: PrismaClient) {
  for (const p of PRODUCTS) await prisma.product.upsert({ where: { code: p.code }, update: {}, create: p });
  for (const t of TANKER_TYPES) await prisma.tankerType.upsert({ where: { code: t.code }, update: {}, create: t });

  if ((await prisma.pricingRule.count()) === 0) {
    const products = new Map((await prisma.product.findMany()).map((p) => [p.code, p.id]));
    const types = new Map((await prisma.tankerType.findMany()).map((t) => [t.code, t.id]));
    for (const r of PRICING_RULES) {
      await prisma.pricingRule.create({
        data: {
          name: r.name,
          ratePerKm: r.ratePerKm,
          minimumFreight: r.minimumFreight,
          additionalCharge: r.additionalCharge ?? 0,
          additionalChargeLabel: r.additionalChargeLabel,
          capacityKl: r.capacityKl,
          productId: r.product ? products.get(r.product) : undefined,
          tankerTypeId: r.tankerType ? types.get(r.tankerType) : undefined,
          originState: r.originState,
          destState: r.destState,
          priority: r.priority,
        },
      });
    }
  }

  const defaults = SETTINGS_SCHEMA.parse({});
  const descriptions: Record<string, string> = {
    offerMinPercentOfSuggested: 'Lowest allowed customer offer, as % of suggested freight',
    offerMaxPercentOfSuggested: 'Highest allowed customer offer, as % of suggested freight',
    offerExpiryHours: 'Validity of transporter offers and counter-offers (hours)',
    maxNegotiationRounds: 'Maximum negotiation rounds per transporter',
    platformFeePercent: 'Platform fee on agreed freight (%)',
    gstPercent: 'GST on freight + platform fee where applicable (%)',
    advancePercent: 'Advance payable after confirmation (% of total)',
    heavyVehicleEtaFactor: 'Multiplier applied to car ETA for loaded tankers',
    defaultRatePerKm: 'Fallback rate when no pricing rule matches (Rs/km)',
    defaultMinimumFreight: 'Fallback minimum freight per tanker (Rs)',
    allowPendingCompanyBookings: 'Allow companies awaiting verification to create bookings',
    maxTankersPerBooking: 'Maximum tankers in one booking',
  };
  for (const [key, value] of Object.entries(defaults)) {
    await prisma.platformSetting.upsert({ where: { key }, update: {}, create: { key, value, description: descriptions[key] } });
  }
}
