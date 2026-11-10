import nodemailer, { type Transporter } from 'nodemailer';
import { OtpDeliveryError, PURPOSE_TEXT, type EmailOtpProvider, type OtpMessage } from './types';

export class SmtpEmailProvider implements EmailOtpProvider {
  readonly name = 'smtp';
  private readonly transport: Transporter;

  constructor(
    private readonly cfg: { host: string; port: number; user?: string; password?: string; from: string },
  ) {
    this.transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
    });
  }

  async sendOtp(m: OtpMessage): Promise<void> {
    const minutes = Math.ceil(m.expiresInSeconds / 60);
    try {
      await this.transport.sendMail({
        from: this.cfg.from,
        to: m.destination,
        subject: `Your TankerLink verification code: ${m.code}`,
        text: `Use ${m.code} to ${PURPOSE_TEXT[m.purpose]}. The code expires in ${minutes} minutes.\n\nIf you did not request this, you can ignore this email.`,
      });
    } catch (e) {
      throw new OtpDeliveryError(this.name, (e as Error).message);
    }
  }
}
