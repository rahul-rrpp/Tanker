import { createHash } from 'node:crypto';
import type { ActorType, Prisma } from '@prisma/client';
import type { Request } from 'express';
import { logger } from '../../lib/logger';
import { prisma, type Tx } from '../../lib/prisma';

export interface BusinessAuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  companyId?: string | null;
  actorUserId?: string | null;
  actorType?: ActorType;
  metadata?: Prisma.InputJsonValue;
  /** Admin module the action belongs to (companies, payments, settings...). */
  module?: string;
  previousValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
  req?: Request;
}

const canonical = (v: unknown): string => {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object' && !(v instanceof Date)) {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v instanceof Date ? v.toISOString() : v);
};

/** Hash of one audit row, chained to the previous row's hash. */
export function auditHash(prevHash: string | null, row: Record<string, unknown>): string {
  return createHash('sha256').update(`${prevHash ?? ''}|${canonical(row)}`).digest('hex');
}

function actorTypeFor(req?: Request): ActorType {
  const roles = req?.auth?.principal.roles ?? [];
  if (roles.includes('SUPER_ADMIN')) return 'ADMIN';
  if (roles.includes('EMPLOYEE')) return 'EMPLOYEE';
  return 'COMPANY';
}

async function write(tx: Tx, input: BusinessAuditInput) {
  // Serialise writers so the hash chain stays linear.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('audit_chain'))`;
  const last = await tx.auditLog.findFirst({ where: { hash: { not: null } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { hash: true, createdAt: true } });
  const p = input.req?.auth?.principal;
  // Strictly increasing timestamps keep the chain order unambiguous.
  const now = new Date(Math.max(Date.now(), (last?.createdAt.getTime() ?? 0) + 1));
  const row = {
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    companyId: input.companyId ?? input.req?.company?.id ?? null,
    actorUserId: input.actorUserId ?? p?.userId ?? null,
    actorType: input.actorType ?? actorTypeFor(input.req),
    actorRole: p ? (p.employee?.roleCode ?? p.roles[0] ?? null) : null,
    module: input.module ?? null,
    metadata: (input.metadata ?? null) as Prisma.InputJsonValue | null,
    previousValue: (input.previousValue ?? null) as Prisma.InputJsonValue | null,
    newValue: (input.newValue ?? null) as Prisma.InputJsonValue | null,
    sessionId: input.req?.auth?.sessionId ?? null,
    ipAddress: input.req?.ip ?? null,
    userAgent: input.req?.headers['user-agent']?.slice(0, 300) ?? null,
    createdAt: now,
  };
  const hash = auditHash(last?.hash ?? null, row);
  await tx.auditLog.create({
    data: {
      ...row,
      metadata: row.metadata ?? undefined,
      previousValue: row.previousValue ?? undefined,
      newValue: row.newValue ?? undefined,
      prevHash: last?.hash ?? null,
      hash,
    },
  });
}

/** Business audit trail. Inside a transaction a failure aborts it; outside, failures are logged only. */
export async function audit(input: BusinessAuditInput, tx: Tx = prisma): Promise<void> {
  if (tx !== prisma) return write(tx, input);
  try {
    await prisma.$transaction((t) => write(t, input));
  } catch (err) {
    logger.error({ err, action: input.action }, 'Failed to write audit log');
  }
}

/** Walks the hash chain and reports the first row whose hash or link does not verify. */
export async function verifyAuditChain(limit = 20000) {
  const rows = await prisma.auditLog.findMany({ where: { hash: { not: null } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit });
  let prev: string | null = null;
  for (const r of rows) {
    const expected = auditHash(prev, {
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      companyId: r.companyId,
      actorUserId: r.actorUserId,
      actorType: r.actorType,
      actorRole: r.actorRole,
      module: r.module,
      metadata: r.metadata,
      previousValue: r.previousValue,
      newValue: r.newValue,
      sessionId: r.sessionId,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      createdAt: r.createdAt,
    });
    if (r.prevHash !== prev || r.hash !== expected) {
      return { valid: false, checked: rows.length, brokenAt: { id: r.id, createdAt: r.createdAt, action: r.action } };
    }
    prev = r.hash;
  }
  return { valid: true, checked: rows.length, brokenAt: null };
}
