/**
 * ============================================================================
 *  DEVELOPMENT / TEST ONLY — MOCK OTP PROVIDER
 * ============================================================================
 * Does NOT deliver anything. Codes are written to the server log and kept in
 * an in-memory outbox so automated tests can read them.
 *
 * Refuses to construct when NODE_ENV=production (env validation also rejects
 * OTP_PROVIDER=mock / EMAIL_PROVIDER=mock in production).
 */
import { logger } from '../../../lib/logger';
import type { EmailOtpProvider, OtpMessage, SmsOtpProvider } from './types';

const outbox = new Map<string, OtpMessage>();

export class MockOtpProvider implements SmsOtpProvider, EmailOtpProvider {
  readonly name: string;

  constructor(channel: 'sms' | 'email') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MockOtpProvider must never be used in production');
    }
    this.name = `mock-${channel}`;
  }

  async sendOtp(message: OtpMessage): Promise<void> {
    outbox.set(message.destination, message);
    logger.warn(
      { provider: this.name, destination: message.destination, purpose: message.purpose, code: message.code },
      '[MOCK OTP] code generated (development only, not delivered)',
    );
    // pino redacts "*.code" in nested objects; print explicitly for local development.
    if (process.env.NODE_ENV === 'development') {
      console.log(`\n  [MOCK OTP] ${message.purpose} code for ${message.destination}: ${message.code}\n`);
    }
  }
}

/** Test helper: last code "sent" to a destination. Unavailable in production. */
export function getMockOtp(destination: string): string | undefined {
  if (process.env.NODE_ENV === 'production') return undefined;
  return outbox.get(destination)?.code;
}

export function clearMockOutbox() {
  outbox.clear();
}
