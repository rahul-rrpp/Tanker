import { randomUUID } from 'node:crypto';
import type { RefreshSession } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { prisma, type Tx } from '../../lib/prisma';
import { generateOpaqueToken, hmac } from '../../utils/crypto';
import { AppError, ErrorCode } from '../../utils/errors';
import type { RequestContext } from './context';
import { writeAudit } from './audit.service';

/** Window in which a just-rotated refresh token is treated as a benign race, not theft. */
const ROTATION_GRACE_MS = 10_000;

export interface AccessClaims {
  sub: string; // user id
  sid: string; // session family id
  typ: 'access';
}

const hashRefreshToken = (token: string) => hmac(env.JWT_REFRESH_SECRET, token);

export function signAccessToken(userId: string, familyId: string): string {
  const claims: AccessClaims = { sub: userId, sid: familyId, typ: 'access' };
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    expiresIn: env.ACCESS_TOKEN_EXPIRY,
    jwtid: randomUUID(),
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    const claims = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    }) as AccessClaims;
    if (claims.typ !== 'access' || !claims.sub || !claims.sid) throw new Error('wrong token type');
    return claims;
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError) throw AppError.unauthorized('Access token expired', ErrorCode.TOKEN_EXPIRED);
    throw AppError.unauthorized('Invalid access token', ErrorCode.INVALID_TOKEN);
  }
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: Date;
  sessionId: string; // family id
  persistent: boolean;
}

/** Starts a new session family (a fresh login). */
export async function createSession(userId: string, ctx: RequestContext, tx: Tx = prisma): Promise<IssuedTokens> {
  const refreshToken = generateOpaqueToken();
  const familyId = randomUUID();
  const persistent = ctx.persistent ?? true;
  const expiresAt = new Date(Date.now() + (ctx.expirySeconds ?? (persistent ? env.REFRESH_TOKEN_EXPIRY : env.SHORT_SESSION_EXPIRY)) * 1000);
  await tx.refreshSession.create({
    data: {
      userId,
      familyId,
      tokenHash: hashRefreshToken(refreshToken),
      clientType: ctx.clientType,
      persistent,
      deviceInfo: ctx.deviceInfo,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      expiresAt,
    },
  });
  return {
    accessToken: signAccessToken(userId, familyId),
    refreshToken,
    accessTokenExpiresIn: env.ACCESS_TOKEN_EXPIRY,
    refreshTokenExpiresAt: expiresAt,
    sessionId: familyId,
    persistent,
  };
}

/**
 * Exchanges a refresh token for a new pair (rotation).
 * Presenting an already-rotated token outside the grace window is treated as theft:
 * the entire session family is revoked.
 */
export async function rotateRefreshToken(rawToken: string, ctx: RequestContext): Promise<IssuedTokens & { userId: string }> {
  const tokenHash = hashRefreshToken(rawToken);
  const session = await prisma.refreshSession.findUnique({ where: { tokenHash } });
  if (!session) throw AppError.unauthorized('Invalid refresh token', ErrorCode.INVALID_TOKEN);

  if (session.revokedAt) {
    if (session.revokedReason === 'ROTATED') {
      if (Date.now() - session.revokedAt.getTime() < ROTATION_GRACE_MS) {
        // Two tabs/requests refreshed simultaneously; the other one already holds the new token.
        throw new AppError(409, ErrorCode.REFRESH_CONFLICT, 'Session was just refreshed by another request. Retry.');
      }
      await revokeFamily(session.familyId, 'REUSE_DETECTED');
      await writeAudit({
        userId: session.userId,
        event: 'REFRESH_TOKEN_REUSE',
        method: 'REFRESH',
        success: false,
        failureReason: 'REFRESH_TOKEN_REUSED',
        ctx,
      });
      throw AppError.unauthorized('Session invalidated for security reasons. Please sign in again.', ErrorCode.REFRESH_TOKEN_REUSED);
    }
    throw AppError.unauthorized('Session has ended. Please sign in again.', ErrorCode.SESSION_REVOKED);
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokedReason: 'EXPIRED' } });
    throw AppError.unauthorized('Session expired. Please sign in again.', ErrorCode.SESSION_REVOKED);
  }

  const newToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + (session.persistent ? env.REFRESH_TOKEN_EXPIRY : env.SHORT_SESSION_EXPIRY) * 1000);
  await prisma.$transaction(async (tx) => {
    // Conditional revoke guarantees only one concurrent rotation wins.
    const won = await tx.refreshSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'ROTATED', lastUsedAt: new Date() },
    });
    if (won.count !== 1) throw new AppError(409, ErrorCode.REFRESH_CONFLICT, 'Session was just refreshed by another request. Retry.');
    const next = await tx.refreshSession.create({
      data: {
        userId: session.userId,
        familyId: session.familyId,
        tokenHash: hashRefreshToken(newToken),
        clientType: session.clientType,
        persistent: session.persistent,
        deviceInfo: ctx.deviceInfo ?? session.deviceInfo,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent ?? session.userAgent,
        expiresAt,
      },
    });
    await tx.refreshSession.update({ where: { id: session.id }, data: { replacedById: next.id } });
  });

  return {
    userId: session.userId,
    accessToken: signAccessToken(session.userId, session.familyId),
    refreshToken: newToken,
    accessTokenExpiresIn: env.ACCESS_TOKEN_EXPIRY,
    refreshTokenExpiresAt: expiresAt,
    sessionId: session.familyId,
    persistent: session.persistent,
  };
}

/** Finds the session family a refresh token belongs to (used by logout without an access token). */
export async function findSessionByRefreshToken(rawToken: string): Promise<RefreshSession | null> {
  return prisma.refreshSession.findUnique({ where: { tokenHash: hashRefreshToken(rawToken) } });
}

/** An access token is valid only while its session family has a live (non-revoked, unexpired) head. */
export async function isSessionActive(userId: string, familyId: string): Promise<boolean> {
  const live = await prisma.refreshSession.findFirst({
    where: { familyId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return live !== null;
}

export async function revokeFamily(familyId: string, reason: string, tx: Tx = prisma) {
  await tx.refreshSession.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
}

export async function revokeAllUserSessions(userId: string, reason: string, opts: { exceptFamilyId?: string } = {}, tx: Tx = prisma) {
  const result = await tx.refreshSession.updateMany({
    where: { userId, revokedAt: null, ...(opts.exceptFamilyId ? { familyId: { not: opts.exceptFamilyId } } : {}) },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}

export async function listActiveSessions(userId: string) {
  return prisma.refreshSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: {
      familyId: true,
      clientType: true,
      deviceInfo: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      expiresAt: true,
    },
  });
}
