import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

const fieldKey = () => createHash('sha256').update(env.FIELD_ENCRYPTION_KEY ?? `dev-only:${env.OTP_HASH_SECRET}`).digest();

/** AES-256-GCM for sensitive columns. Output: base64url iv.tag.ciphertext */
export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', fieldKey(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decryptField(stored: string): string {
  const [iv, tag, data] = stored.split('.').map((p) => Buffer.from(p, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', fieldKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

/** Keyed hash (HMAC-SHA256, hex). Used for OTPs, refresh tokens and invitation codes. */
export function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Cryptographically secure numeric code with leading zeros preserved. */
export function generateNumericCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i++) code += randomInt(0, 10).toString();
  return code;
}

/** URL-safe opaque token (used for refresh tokens and CSRF tokens). */
export function generateOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

/** Human-friendly invitation code, e.g. "K7QM-2XPA". */
export function generateInvitationCode(): string {
  const chars = Array.from({ length: 8 }, () => INVITE_ALPHABET[randomInt(0, INVITE_ALPHABET.length)]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

export function normaliseInvitationCode(code: string): string {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}
