import { Prisma } from '@prisma/client';
import { round2 } from '../../lib/money';
import type { PlatformSettings } from '../settings/settings.service';

/** Freight invoice composition. GST applies on freight + platform fee at the configured rate. */
export function invoiceAmounts(freightValue: Prisma.Decimal.Value, settings: Pick<PlatformSettings, 'platformFeePercent' | 'gstPercent' | 'advancePercent'>) {
  const freight = round2(freightValue);
  const platformFee = round2(freight.times(settings.platformFeePercent).dividedBy(100));
  const gst = round2(freight.plus(platformFee).times(settings.gstPercent).dividedBy(100));
  const total = round2(freight.plus(platformFee).plus(gst));
  const advance = round2(total.times(settings.advancePercent).dividedBy(100));
  return { freight, platformFee, gst, total, advance };
}

export const ZERO = new Prisma.Decimal(0);
