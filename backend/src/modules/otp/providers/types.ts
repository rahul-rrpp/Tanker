import type { OtpPurpose } from '@prisma/client';

export interface OtpMessage {
  destination: string; // normalised phone (10 digits) or lower-cased email
  code: string;
  purpose: OtpPurpose;
  expiresInSeconds: number;
}

/** Sends an OTP over SMS. Implementations must never log the code outside the mock provider. */
export interface SmsOtpProvider {
  readonly name: string;
  sendOtp(message: OtpMessage): Promise<void>;
}

/** Sends an OTP by email. */
export interface EmailOtpProvider {
  readonly name: string;
  sendOtp(message: OtpMessage): Promise<void>;
}

export class OtpDeliveryError extends Error {
  constructor(provider: string, reason: string) {
    super(`[${provider}] OTP delivery failed: ${reason}`);
    this.name = 'OtpDeliveryError';
  }
}

export const PURPOSE_TEXT: Record<OtpPurpose, string> = {
  REGISTRATION: 'complete your OnlyTanker registration',
  LOGIN: 'sign in to OnlyTanker',
  PASSWORD_RESET: 'reset your OnlyTanker password',
  EMAIL_VERIFICATION: 'verify your email address on OnlyTanker',
  PHONE_CHANGE: 'confirm your new mobile number on OnlyTanker',
  EMAIL_CHANGE: 'confirm your new email address on OnlyTanker',
  ADMIN_2FA: 'complete your OnlyTanker admin sign-in',
  BANK_CHANGE: 'confirm a change to your OnlyTanker payout bank account',
};
