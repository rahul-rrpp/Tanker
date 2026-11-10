import { z } from 'zod';

/** Accepts "9876543210", "+91 98765 43210", "09876543210" and normalises to 10 digits. */
export const phoneSchema = z
  .string({ required_error: 'Mobile number is required' })
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

/** Optional email that also tolerates an empty string from forms. */
export const optionalEmailSchema = z
  .union([emailSchema, z.literal('').transform(() => undefined)])
  .optional();

export const passwordSchema = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/\d/, 'Password must contain a number');

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, 'Name is too short')
  .max(120)
  .regex(/^[\p{L} .'-]+$/u, 'Name contains invalid characters');

export const gstSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN');

export const optionalGstSchema = z.union([gstSchema, z.literal('').transform(() => undefined)]).optional();

export const panSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter a valid 10-character PAN');

export const pincodeSchema = z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code');

export const otpCodeSchema = z.string().trim().regex(/^\d{4,8}$/, 'Enter the numeric code you received');

export const deviceInfoSchema = z.string().trim().max(200).optional();

/** Email or phone used as a login identifier. */
export function classifyIdentifier(raw: string): { type: 'email'; value: string } | { type: 'phone'; value: string } | null {
  const v = raw.trim();
  if (v.includes('@')) {
    const r = emailSchema.safeParse(v);
    return r.success ? { type: 'email', value: r.data } : null;
  }
  const r = phoneSchema.safeParse(v);
  return r.success ? { type: 'phone', value: r.data } : null;
}

export function maskDestination(dest: string): string {
  if (dest.includes('@')) {
    const [local, domain] = dest.split('@');
    return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
  }
  return `${'*'.repeat(Math.max(0, dest.length - 4))}${dest.slice(-4)}`;
}
