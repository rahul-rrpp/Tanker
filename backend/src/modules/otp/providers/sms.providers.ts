import { OtpDeliveryError, PURPOSE_TEXT, type OtpMessage, type SmsOtpProvider } from './types';

const TIMEOUT_MS = 10_000;

async function postJson(provider: string, url: string, init: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((e: Error) => {
    throw new OtpDeliveryError(provider, e.message);
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new OtpDeliveryError(provider, `HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return res;
}

/**
 * MSG91 (India) — Flow/OTP template API.
 * SMS_API_KEY = authkey, SMS_TEMPLATE_ID = DLT-approved template with variables `otp` and `minutes`.
 */
export class Msg91SmsProvider implements SmsOtpProvider {
  readonly name = 'msg91';
  constructor(private readonly cfg: { apiKey: string; templateId: string; senderId?: string }) {}

  async sendOtp(m: OtpMessage): Promise<void> {
    await postJson(this.name, 'https://control.msg91.com/api/v5/flow', {
      method: 'POST',
      headers: { authkey: this.cfg.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        template_id: this.cfg.templateId,
        sender: this.cfg.senderId,
        short_url: '0',
        recipients: [{ mobiles: `91${m.destination}`, otp: m.code, minutes: String(Math.ceil(m.expiresInSeconds / 60)) }],
      }),
    });
  }
}

/**
 * Twilio Programmable SMS.
 * TWILIO_ACCOUNT_SID = account SID, SMS_API_KEY = auth token, SMS_SENDER_ID = sending number / messaging service SID.
 */
export class TwilioSmsProvider implements SmsOtpProvider {
  readonly name = 'twilio';
  constructor(private readonly cfg: { accountSid: string; authToken: string; from: string }) {}

  async sendOtp(m: OtpMessage): Promise<void> {
    const minutes = Math.ceil(m.expiresInSeconds / 60);
    const body = new URLSearchParams({
      To: `+91${m.destination}`,
      Body: `${m.code} is your code to ${PURPOSE_TEXT[m.purpose]}. Valid for ${minutes} min. Do not share it with anyone.`,
    });
    body.set(this.cfg.from.startsWith('MG') ? 'MessagingServiceSid' : 'From', this.cfg.from);
    const auth = Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString('base64');
    await postJson(this.name, `https://api.twilio.com/2010-04-01/Accounts/${this.cfg.accountSid}/Messages.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
  }
}
