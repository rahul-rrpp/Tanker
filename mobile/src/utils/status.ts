import type { Tone } from '@/types';

/** Status → tone, for bookings, trips, offers and tickets. */
export function toneFor(status: string): Tone {
  if (/COMPLETED|DELIVERED|ACCEPTED|APPROVED|VERIFIED|SETTLED|RESOLVED|PAID/.test(status)) return 'success';
  if (/CANCELLED|REJECTED|SUSPENDED|FAILED|DISPUTED|EXPIRED/.test(status)) return 'danger';
  if (/PENDING|COUNTERED|SEARCHING|OFFERS|NEGOTIATION|OPEN|ON_HOLD/.test(status)) return 'warning';
  return 'info';
}
