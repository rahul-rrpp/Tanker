// Test environment — loaded before any application module (and therefore before env validation).
/** Override with TEST_DB_PORT if a previous run left a Postgres instance behind. */
export const TEST_DB_PORT = Number(process.env.TEST_DB_PORT ?? 54330);

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: `postgresql://ttms:ttms@localhost:${TEST_DB_PORT}/ttms_test?schema=public`,
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789-abcdefghijklmnop',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789-abcdefghijklmnop',
  OTP_HASH_SECRET: 'test-otp-secret-0123456789-abcdefghijklmnopqrs',
  ACCESS_TOKEN_EXPIRY: '15m',
  REFRESH_TOKEN_EXPIRY: '30d',
  OTP_PROVIDER: 'mock',
  EMAIL_PROVIDER: 'mock',
  OTP_RESEND_COOLDOWN: '45s',
  OTP_MAX_SENDS_PER_HOUR: '20',
  RATE_LIMIT_ENABLED: 'false',
  CORS_ORIGINS: 'http://localhost:3000',
  WEB_APP_URL: 'http://localhost:3000',
  COOKIE_SECURE: 'false',
  ENABLED_PORTALS: 'all',
  DEMO_MODE: 'true',
  OTP_DEV_ECHO: 'false',
  MAPS_FALLBACK_PROVIDER: 'fixture',
  GOOGLE_MAPS_SERVER_KEY: '',
  PAYMENT_PROVIDER: 'mock',
  UPLOAD_DIR: 'uploads-test',
});
