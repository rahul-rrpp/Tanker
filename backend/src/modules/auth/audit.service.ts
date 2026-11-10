import type { AuthEvent, LoginMethod } from '@prisma/client';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import type { RequestContext } from './context';

export interface AuditInput {
  userId?: string | null;
  identifier?: string | null;
  event: AuthEvent;
  method?: LoginMethod;
  success: boolean;
  failureReason?: string;
  ctx?: RequestContext;
}

/** Audit writes must never break the auth flow, so failures are logged and swallowed. */
export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.loginAudit.create({
      data: {
        userId: input.userId ?? null,
        identifier: input.identifier ?? null,
        event: input.event,
        method: input.method,
        success: input.success,
        failureReason: input.failureReason,
        clientType: input.ctx?.clientType,
        ipAddress: input.ctx?.ip,
        userAgent: input.ctx?.userAgent,
      },
    });
  } catch (err) {
    logger.error({ err, event: input.event }, 'Failed to write login audit');
  }
}
