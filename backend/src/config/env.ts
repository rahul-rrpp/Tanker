import 'dotenv/config';
import { z } from 'zod';

/** Parses durations such as "15m", "30d", "300s", "2h" or a raw number of seconds. */
export function parseDurationSeconds(value: string): number {
  const match = /^(\d+)\s*([smhd]?)$/i.exec(value.trim());
  if (!match) throw new Error(`Invalid duration "${value}" (use e.g. 300s, 15m, 12h, 30d)`);
  const n = Number(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  const factor = unit === 'm' ? 60 : unit === 'h' ? 3600 : unit === 'd' ? 86400 : 1;
  return n * factor;
}

const duration = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((v, ctx) => {
      try {
        return parseDurationSeconds(v);
      } catch (e) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message });
        return z.NEVER;
      }
    });

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(fallback ? 'true' : 'false')
    .transform((v) => v === 'true' || v === '1');

const int = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const secret = z.string().min(32, 'must be at least 32 characters');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: z.string().default('1'),

    DATABASE_URL: z.string().url(),

    JWT_ACCESS_SECRET: secret,
    JWT_REFRESH_SECRET: secret,
    OTP_HASH_SECRET: secret,
    JWT_ISSUER: z.string().default('ttms-auth'),
    JWT_AUDIENCE: z.string().default('ttms'),
    ACCESS_TOKEN_EXPIRY: duration('15m'),
    REFRESH_TOKEN_EXPIRY: duration('30d'),
    VERIFICATION_TOKEN_EXPIRY: duration('15m'),

    OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
    OTP_EXPIRY: duration('5m'),
    OTP_RESEND_COOLDOWN: duration('45s'),
    OTP_MAX_ATTEMPTS: int(5),
    OTP_MAX_SENDS_PER_HOUR: int(5),
    OTP_PROVIDER: z.enum(['mock', 'msg91', 'twilio']).default('mock'),
    SMS_API_KEY: z.string().optional(),
    SMS_SENDER_ID: z.string().optional(),
    SMS_TEMPLATE_ID: z.string().optional(),
    TWILIO_ACCOUNT_SID: z.string().optional(),

    EMAIL_PROVIDER: z.enum(['mock', 'smtp']).default('mock'),
    EMAIL_FROM: z.string().default('TTMS <no-reply@ttms.local>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    EMAIL_VERIFICATION_REQUIRED: bool(false),

    MAX_FAILED_LOGINS: int(5),
    ACCOUNT_LOCK_DURATION: duration('15m'),
    RATE_LIMIT_ENABLED: bool(true),

    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    WEB_APP_URL: z.string().url().default('http://localhost:3000'),
    COOKIE_SECURE: bool(false),
    COOKIE_DOMAIN: z.string().optional(),
    /** Session length when "Remember me" is NOT ticked (cookies also become browser-session cookies). */
    SHORT_SESSION_EXPIRY: duration('12h'),

    // ---- Release scope -------------------------------------------------------------------
    /** "company" = only the Company Portal can sign in / register (Phase 1). "all" = every role (tests, future). */
    ENABLED_PORTALS: z
      .string()
      .default('company')
      .refine((v) => v.split(',').every((p) => ['company', 'admin', 'transporter', 'driver', 'employee', 'all'].includes(p.trim())), 'Use a comma list of: company, admin, transporter, driver, employee, all'),
    /** Admin Portal session length (admins never get "remember me"). */
    ADMIN_SESSION_EXPIRY: duration('8h'),
    /** Enables the clearly-labelled demo simulator endpoints (/api/v1/demo/*). Never enable for real customers. */
    DEMO_MODE: bool(false),
    /** Development only: echo mock OTP codes in API responses so the UI can display them. */
    OTP_DEV_ECHO: bool(false),

    // ---- Maps ------------------------------------------------------------------------------
    /** Server-side Google Maps Platform key (Places API (New), Routes API, Geocoding). Never sent to browsers. */
    GOOGLE_MAPS_SERVER_KEY: z.string().optional(),
    /** Used when no Google key is configured: "osm" = OSRM road routing + Photon geocoding (development). */
    MAPS_FALLBACK_PROVIDER: z.enum(['osm', 'fixture', 'none']).default('osm'),
    OSRM_URL: z.string().url().default('https://router.project-osrm.org'),
    PHOTON_URL: z.string().url().default('https://photon.komoot.io'),
    MAPS_USER_AGENT: z.string().default('TankerLink/1.0 (development)'),

    // ---- Payments --------------------------------------------------------------------------
    /** razorpay (test or live keys) | mock (development gateway simulator; rejected in production). */
    PAYMENT_PROVIDER: z.enum(['razorpay', 'mock']).default('mock'),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

    // ---- File storage ----------------------------------------------------------------------
    STORAGE_DRIVER: z.enum(['local']).default('local'),
    UPLOAD_DIR: z.string().default('uploads'),
    MAX_UPLOAD_MB: z.coerce.number().positive().max(25).default(5),

    // ---- Transporter portal ----------------------------------------------------------------
    /** 32+ characters. Encrypts bank account numbers at rest. Required in production. */
    FIELD_ENCRYPTION_KEY: z.string().min(32).optional(),
    /** Shared key for dedicated GPS hardware / telematics posting to /api/v1/gps/ingest. Unset = endpoint disabled. */
    GPS_INGEST_KEY: z.string().min(24).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (env.OTP_PROVIDER === 'mock') {
      ctx.addIssue({ code: 'custom', path: ['OTP_PROVIDER'], message: 'mock OTP provider is not allowed in production' });
    }
    if (env.EMAIL_PROVIDER === 'mock') {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'mock email provider is not allowed in production' });
    }
    if (env.OTP_DEV_ECHO) {
      ctx.addIssue({ code: 'custom', path: ['OTP_DEV_ECHO'], message: 'OTP_DEV_ECHO is not allowed in production' });
    }
    if (env.PAYMENT_PROVIDER === 'mock') {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'mock payment provider is not allowed in production' });
    }
    if (env.MAPS_FALLBACK_PROVIDER === 'fixture') {
      ctx.addIssue({ code: 'custom', path: ['MAPS_FALLBACK_PROVIDER'], message: 'fixture routing is for automated tests only' });
    }
    if (env.PAYMENT_PROVIDER === 'razorpay' && (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET)) {
      ctx.addIssue({ code: 'custom', path: ['RAZORPAY_KEY_ID'], message: 'Razorpay keys are required' });
    }
    if (!env.COOKIE_SECURE) {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'COOKIE_SECURE must be true in production' });
    }
    if (env.OTP_PROVIDER !== 'mock' && !env.SMS_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['SMS_API_KEY'], message: 'required for the selected OTP provider' });
    }
    if (!env.FIELD_ENCRYPTION_KEY) {
      ctx.addIssue({ code: 'custom', path: ['FIELD_ENCRYPTION_KEY'], message: 'required in production (encrypts bank details)' });
    }
    const secrets = [env.JWT_ACCESS_SECRET, env.JWT_REFRESH_SECRET, env.OTP_HASH_SECRET];
    if (new Set(secrets).size !== secrets.length) {
      ctx.addIssue({ code: 'custom', path: ['JWT_ACCESS_SECRET'], message: 'JWT/OTP secrets must all be different' });
    }
  });

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return {
    ...parsed.data,
    corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    isProduction: parsed.data.NODE_ENV === 'production',
    isTest: parsed.data.NODE_ENV === 'test',
  };
}

export const env = load();
export type Env = typeof env;
