import type { Tx } from '../../lib/prisma';

const SEQS = new Set(['employee_code_seq', 'lead_code_seq', 'task_code_seq', 'settlement_code_seq', 'subscription_code_seq', 'service_code_seq', 'service_order_code_seq', 'company_code_seq']);

/** Sequential human-readable codes for admin entities (sequence names come from a fixed allow-list). */
export async function nextCodeRaw(tx: Tx, seq: string, prefix: string, pad: number): Promise<string> {
  if (!SEQS.has(seq)) throw new Error(`Unknown sequence ${seq}`);
  const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT nextval('${seq}') AS n`);
  return `${prefix}${String(rows[0].n).padStart(pad, '0')}`;
}
