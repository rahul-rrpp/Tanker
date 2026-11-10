import { z } from 'zod';
import { prisma } from '../../lib/prisma';

/**
 * Platform settings live in the platform_settings table (admin-editable in a future phase). Missing keys
 * fall back to these defaults, so a fresh database works out of the box.
 */
export const SETTINGS_SCHEMA = z.object({
  /** Customer offer must be within [min%, max%] of the suggested freight. */
  offerMinPercentOfSuggested: z.number().min(1).max(100).default(50),
  offerMaxPercentOfSuggested: z.number().min(100).max(1000).default(200),
  /** Hours a transporter offer / counter-offer stays valid. */
  offerExpiryHours: z.number().int().min(1).max(168).default(24),
  /** Maximum negotiation rounds per transporter thread. */
  maxNegotiationRounds: z.number().int().min(1).max(20).default(5),
  platformFeePercent: z.number().min(0).max(20).default(2),
  /** GST on freight + platform fee, where applicable (GTA services - confirm with your tax advisor). */
  gstPercent: z.number().min(0).max(28).default(5),
  advancePercent: z.number().min(0).max(100).default(30),
  /** Loaded tankers are slower than cars; road ETA is multiplied by this factor. */
  heavyVehicleEtaFactor: z.number().min(1).max(3).default(1.3),
  /** Fallback rate when no pricing rule matches. */
  defaultRatePerKm: z.number().positive().default(55),
  defaultMinimumFreight: z.number().min(0).default(8000),
  allowPendingCompanyBookings: z.boolean().default(false),
  maxTankersPerBooking: z.number().int().min(1).max(100).default(20),
  /** Marketplace: show a booking only if a free tanker is within this distance of pickup. 0 = no radius limit. */
  marketplaceRadiusKm: z.number().min(0).max(5000).default(0),
  /** Marketplace: only bookings in the transporter's operating states (when any are declared). */
  marketplaceMatchOperatingStates: z.boolean().default(true),
  /** Buffer added after expected delivery when reserving a tanker and driver. */
  assignmentBufferHours: z.number().min(0).max(72).default(6),
  /** Attendance rules (company policy; edit through /admin/hr/attendance-rules). */
  shiftStart: z.string().default('09:30'),
  shiftEnd: z.string().default('18:30'),
  lateGraceMinutes: z.number().int().default(15),
  fullDayMinutes: z.number().int().default(480),
  halfDayMinutes: z.number().int().default(240),
  weeklyOffDays: z.array(z.number().int()).default([0]),
  holidays: z.array(z.string()).default([]),
  gpsOfflineMinutes: z.number().int().min(1).max(1440).default(15),
  routeDeviationKm: z.number().min(0.5).max(100).default(5),
  stoppageMinutes: z.number().int().min(5).max(1440).default(45),
});

export type PlatformSettings = z.infer<typeof SETTINGS_SCHEMA>;

let cache: { at: number; value: PlatformSettings } | null = null;
const TTL_MS = 30_000;

export async function getSettings(): Promise<PlatformSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const rows = await prisma.platformSetting.findMany();
  const raw = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const parsed = SETTINGS_SCHEMA.safeParse(raw);
  // Invalid stored values never break the platform: fall back to defaults key by key.
  const value = parsed.success ? parsed.data : SETTINGS_SCHEMA.parse({});
  cache = { at: Date.now(), value };
  return value;
}

export function clearSettingsCache() {
  cache = null;
}
