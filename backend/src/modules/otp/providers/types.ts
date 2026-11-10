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
  REGISTRATION: 'complete your TankerLink registration',
  LOGIN: 'sign in to TankerLink',
  PASSWORD_RESET: 'reset your TankerLink password',
  EMAIL_VERIFICATION: 'verify your email address on TankerLink',
  PHONE_CHANGE: 'confirm your new mobile number on TankerLink',
  EMAIL_CHANGE: 'confirm your new email address on TankerLink',
  ADMIN_2FA: 'complete your TankerLink admin sign-in',
  BANK_CHANGE: 'confirm a change to your TankerLink payout bank account',
};
