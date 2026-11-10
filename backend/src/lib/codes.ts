import type { Tx } from './prisma';

/**
 * Human-readable identifiers backed by PostgreSQL sequences (concurrency-safe, never reused).
 * Sequences are created in migration 20261106071000_codes_and_constraints.
 */
const CODES = {
  company: { seq: 'company_code_seq', prefix: 'CMP', pad: 6 }, // CMP000001
  booking: { seq: 'booking_code_seq', prefix: 'TLB', pad: 7 }, // TLB0000001
  ticket: { seq: 'ticket_code_seq', prefix: 'TKT', pad: 6 }, // TKT000001
  invoice: { seq: 'invoice_code_seq', prefix: 'INV-', pad: 6 }, // INV-000001
  receipt: { seq: 'receipt_code_seq', prefix: 'RCP-', pad: 6 }, // RCP-000001
  trip: { seq: 'trip_code_seq', prefix: 'TRP', pad: 7 }, // TRP0000001
} as const;

export type CodeKind = keyof typeof CODES;

export async function nextCode(tx: Tx, kind: CodeKind): Promise<string> {
  const { seq, prefix, pad } = CODES[kind];
  // Sequence names come from the constant map above, never from user input.
  const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT nextval('${seq}') AS n`);
  return `${prefix}${String(rows[0].n).padStart(pad, '0')}`;
}
