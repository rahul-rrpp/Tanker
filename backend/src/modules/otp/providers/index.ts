import { env } from '../../../config/env';
import { SmtpEmailProvider } from './email.providers';
import { MockOtpProvider } from './mock.provider';
import { Msg91SmsProvider, TwilioSmsProvider } from './sms.providers';
import type { EmailOtpProvider, SmsOtpProvider } from './types';

function required(name: string, value: string | number | undefined): string {
  if (value === undefined || value === '') throw new Error(`${name} must be set for the configured OTP/email provider`);
  return String(value);
}

function createSmsProvider(): SmsOtpProvider {
  switch (env.OTP_PROVIDER) {
    case 'msg91':
      return new Msg91SmsProvider({
        apiKey: required('SMS_API_KEY', env.SMS_API_KEY),
        templateId: required('SMS_TEMPLATE_ID', env.SMS_TEMPLATE_ID),
        senderId: env.SMS_SENDER_ID,
      });
    case 'twilio':
      return new TwilioSmsProvider({
        accountSid: required('TWILIO_ACCOUNT_SID', env.TWILIO_ACCOUNT_SID),
        authToken: required('SMS_API_KEY', env.SMS_API_KEY),
        from: required('SMS_SENDER_ID', env.SMS_SENDER_ID),
      });
    case 'mock':
      return new MockOtpProvider('sms');
  }
}

function createEmailProvider(): EmailOtpProvider {
  switch (env.EMAIL_PROVIDER) {
    case 'smtp':
      return new SmtpEmailProvider({
        host: required('SMTP_HOST', env.SMTP_HOST),
        port: Number(required('SMTP_PORT', env.SMTP_PORT)),
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
        from: env.EMAIL_FROM,
      });
    case 'mock':
      return new MockOtpProvider('email');
  }
}

/** Providers are resolved once at startup; swapping vendors needs only an env change. */
export const smsProvider: SmsOtpProvider = createSmsProvider();
export const emailProvider: EmailOtpProvider = createEmailProvider();
