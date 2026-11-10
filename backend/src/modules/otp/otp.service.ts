import type { OtpChannel, OtpPurpose, OTPVerification } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { prisma, type Tx } from '../../lib/prisma';
import { generateNumericCode, hmac, safeEqualHex } from '../../utils/crypto';
import { AppError, ErrorCode } from '../../utils/errors';
import { maskDestination } from '../../utils/validators';
import { emailProvider, smsProvider } from './providers';

const VERIFICATION_AUDIENCE = 'ttms-otp-verification';

const hashOtp = (otpId: string, code: string) => hmac(env.OTP_HASH_SECRET, `${otpId}:${code}`);

export interface SendOtpInput {
  destination: string;
  channel: OtpChannel;
  purpose: OtpPurpose;
  ip?: string | null;
}

export interface SendOtpResult {
  destination: string; // masked
  channel: OtpChannel;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  /** DEVELOPMENT ONLY (OTP_DEV_ECHO with the mock provider): the code itself, for on-screen display. */
  devCode?: string;
}

/** True when codes may be echoed to the client: mock provider + explicit dev flag + never production. */
export const otpDevEchoEnabled = () => env.OTP_DEV_ECHO && !env.isProduction && env.OTP_PROVIDER === 'mock';

/**
 * Generates and delivers a new OTP.
 *  - enforces a per-destination resend cooldown and an hourly send cap
 *  - invalidates any previous unused code for the same destination + purpose
 *  - stores only an HMAC of the code (salted with the row id)
 */
export async function sendOtp({ destination, channel, purpose, ip }: SendOtpInput): Promise<SendOtpResult> {
  const now = Date.now();
  const code = generateNumericCode(env.OTP_LENGTH);

  const record = await prisma.$transaction(async (tx) => {
    // Serialise concurrent sends for the same destination/purpose.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${destination}|${purpose}`}))`;

    const recent = await tx.oTPVerification.findMany({
      where: { destination, purpose, createdAt: { gte: new Date(now - 3600_000) } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (recent.length > 0) {
      const elapsed = (now - recent[0].createdAt.getTime()) / 1000;
      if (elapsed < env.OTP_RESEND_COOLDOWN) {
        const retryAfterSeconds = Math.ceil(env.OTP_RESEND_COOLDOWN - elapsed);
        throw AppError.tooMany(`Please wait ${retryAfterSeconds}s before requesting another code`, ErrorCode.OTP_COOLDOWN, {
          retryAfterSeconds,
        });
      }
    }
    if (recent.length >= env.OTP_MAX_SENDS_PER_HOUR) {
      throw AppError.tooMany('Too many codes requested. Try again later.', ErrorCode.OTP_SEND_LIMIT);
    }

    await tx.oTPVerification.updateMany({
      where: { destination, purpose, verifiedAt: null, invalidated: false },
      data: { invalidated: true },
    });

    const created = await tx.oTPVerification.create({
      data: {
        destination,
        channel,
        purpose,
        otpHash: 'pending',
        expiresAt: new Date(now + env.OTP_EXPIRY * 1000),
        maxAttempts: env.OTP_MAX_ATTEMPTS,
        ipAddress: ip ?? null,
      },
    });
    return tx.oTPVerification.update({ where: { id: created.id }, data: { otpHash: hashOtp(created.id, code) } });
  });

  const provider = channel === 'SMS' ? smsProvider : emailProvider;
  try {
    await provider.sendOtp({ destination, code, purpose, expiresInSeconds: env.OTP_EXPIRY });
  } catch (err) {
    logger.error({ err, provider: provider.name, purpose }, 'OTP delivery failed');
    await prisma.oTPVerification.update({ where: { id: record.id }, data: { invalidated: true } });
    throw new AppError(502, ErrorCode.OTP_DELIVERY_FAILED, 'Could not deliver the verification code. Please try again.');
  }

  const mockChannel = channel === 'SMS' ? env.OTP_PROVIDER === 'mock' : env.EMAIL_PROVIDER === 'mock';
  return {
    destination: maskDestination(destination),
    channel,
    expiresInSeconds: env.OTP_EXPIRY,
    resendAfterSeconds: env.OTP_RESEND_COOLDOWN,
    ...(otpDevEchoEnabled() && mockChannel ? { devCode: code } : {}),
  };
}

/**
 * Checks a code against the latest active OTP. On success the OTP is marked verified and can
 * never be verified again. Wrong codes consume an attempt; exceeding the limit invalidates the OTP.
 */
export async function verifyOtp(destination: string, purpose: OtpPurpose, code: string): Promise<OTPVerification> {
  const otp = await prisma.oTPVerification.findFirst({
    where: { destination, purpose, invalidated: false, verifiedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp) throw AppError.badRequest('Invalid or already used code. Request a new one.', ErrorCode.INVALID_OTP);

  if (otp.expiresAt.getTime() <= Date.now()) {
    await prisma.oTPVerification.update({ where: { id: otp.id }, data: { invalidated: true } });
    throw AppError.badRequest('This code has expired. Request a new one.', ErrorCode.OTP_EXPIRED);
  }

  // Atomically reserve an attempt so parallel guesses cannot exceed the limit.
  const reserved = await prisma.oTPVerification.updateMany({
    where: { id: otp.id, verifiedAt: null, invalidated: false, attempts: { lt: otp.maxAttempts } },
    data: { attempts: { increment: 1 } },
  });
  if (reserved.count === 0) {
    await prisma.oTPVerification.update({ where: { id: otp.id }, data: { invalidated: true } });
    throw AppError.tooMany('Too many incorrect attempts. Request a new code.', ErrorCode.OTP_ATTEMPTS_EXCEEDED);
  }

  if (!safeEqualHex(hashOtp(otp.id, code), otp.otpHash)) {
    const attemptsRemaining = otp.maxAttempts - (otp.attempts + 1);
    if (attemptsRemaining <= 0) {
      await prisma.oTPVerification.update({ where: { id: otp.id }, data: { invalidated: true } });
      throw AppError.tooMany('Too many incorrect attempts. Request a new code.', ErrorCode.OTP_ATTEMPTS_EXCEEDED);
    }
    throw AppError.badRequest('Incorrect code', ErrorCode.INVALID_OTP, { attemptsRemaining });
  }

  const now = new Date();
  const marked = await prisma.oTPVerification.updateMany({
    where: { id: otp.id, verifiedAt: null, invalidated: false },
    data: { verifiedAt: now },
  });
  if (marked.count === 0) throw AppError.badRequest('Invalid or already used code. Request a new one.', ErrorCode.INVALID_OTP);
  return { ...otp, verifiedAt: now, attempts: otp.attempts + 1 };
}

/** Verifies a code and immediately consumes it (login and password reset). */
export async function verifyAndConsumeOtp(destination: string, purpose: OtpPurpose, code: string, tx: Tx = prisma) {
  const otp = await verifyOtp(destination, purpose, code);
  await tx.oTPVerification.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  return otp;
}

interface VerificationClaims {
  typ: 'otp_verification';
  otpId: string;
  dest: string;
  purpose: OtpPurpose;
  channel: OtpChannel;
}

/** Short-lived proof that a destination was verified, presented later (e.g. at registration). */
export function issueVerificationToken(otp: OTPVerification): string {
  const claims: VerificationClaims = {
    typ: 'otp_verification',
    otpId: otp.id,
    dest: otp.destination,
    purpose: otp.purpose,
    channel: otp.channel,
  };
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    issuer: env.JWT_ISSUER,
    audience: VERIFICATION_AUDIENCE,
    expiresIn: env.VERIFICATION_TOKEN_EXPIRY,
  });
}

/**
 * Validates a verification token and marks the underlying OTP consumed inside the caller's
 * transaction, so the same verification can never be used twice.
 */
export async function consumeVerificationToken(
  tx: Tx,
  token: string,
  expected: { destination: string; purpose: OtpPurpose; channel: OtpChannel },
): Promise<void> {
  let claims: VerificationClaims;
  try {
    claims = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: env.JWT_ISSUER,
      audience: VERIFICATION_AUDIENCE,
    }) as VerificationClaims;
  } catch {
    throw AppError.badRequest('Verification expired. Verify your number again.', ErrorCode.INVALID_VERIFICATION_TOKEN);
  }
  if (
    claims.typ !== 'otp_verification' ||
    claims.dest !== expected.destination ||
    claims.purpose !== expected.purpose ||
    claims.channel !== expected.channel
  ) {
    throw AppError.badRequest('Verification does not match the submitted details', ErrorCode.INVALID_VERIFICATION_TOKEN);
  }
  const consumed = await tx.oTPVerification.updateMany({
    where: { id: claims.otpId, verifiedAt: { not: null }, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) {
    throw AppError.badRequest('This verification has already been used', ErrorCode.INVALID_VERIFICATION_TOKEN);
  }
}
