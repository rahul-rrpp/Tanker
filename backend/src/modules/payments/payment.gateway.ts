import { randomBytes } from 'node:crypto';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { hmac, safeEqualHex } from '../../utils/crypto';
import { AppError, ErrorCode } from '../../utils/errors';

/**
 * Payment gateway adapters.
 *
 * RAZORPAY: Orders API + checkout.js. Success is accepted only after (1) the HMAC signature
 *   order_id|payment_id is verified with the key secret AND (2) the payment is fetched from Razorpay and
 *   its order, amount and status match (captured; authorized payments are captured server-side).
 *   Webhooks (payment.captured / payment.failed) are verified with RAZORPAY_WEBHOOK_SECRET.
 * MOCK: development gateway simulator with the same signature scheme. It keeps its own record of
 *   "gateway" payments, so verification still never trusts the browser. Rejected in production.
 */

export interface GatewayOrder {
  orderId: string;
  amountPaise: number;
  currency: 'INR';
}

export interface GatewayPayment {
  id: string;
  orderId: string;
  amountPaise: number;
  status: 'captured' | 'authorized' | 'failed' | 'created' | 'refunded';
  method: string | null;
  raw: Record<string, unknown>;
}

const MOCK_SECRET = () => hmac(env.OTP_HASH_SECRET, 'tankerlink-mock-payment-gateway');
const toHex = (s: string) => Buffer.from(s, 'utf8').toString('hex');

export function signatureFor(orderId: string, paymentId: string, provider: 'RAZORPAY' | 'MOCK'): string {
  const secret = provider === 'RAZORPAY' ? env.RAZORPAY_KEY_SECRET! : MOCK_SECRET();
  return hmac(secret, `${orderId}|${paymentId}`);
}

export function verifySignature(orderId: string, paymentId: string, signature: string, provider: 'RAZORPAY' | 'MOCK'): boolean {
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  return safeEqualHex(signatureFor(orderId, paymentId, provider), signature);
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!env.RAZORPAY_WEBHOOK_SECRET || !signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  return safeEqualHex(hmac(env.RAZORPAY_WEBHOOK_SECRET, rawBody.toString('utf8')), signature);
}

async function razorpay<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  let res: Response;
  try {
    res = await fetch(`https://api.razorpay.com/v1${path}`, {
      ...init,
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    logger.error({ err, path }, 'Razorpay unreachable');
    throw new AppError(502, ErrorCode.PAYMENT_VERIFICATION_FAILED, 'Payment gateway is unreachable. Please try again.');
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
  if (!res.ok) {
    logger.error({ status: res.status, path, error: body.error }, 'Razorpay API error');
    throw new AppError(502, ErrorCode.PAYMENT_VERIFICATION_FAILED, 'Payment gateway rejected the request.');
  }
  return body;
}

export async function createGatewayOrder(provider: 'RAZORPAY' | 'MOCK', amountPaise: number, receipt: string, notes: Record<string, string>): Promise<GatewayOrder> {
  if (provider === 'RAZORPAY') {
    const order = await razorpay<{ id: string; amount: number }>('/orders', {
      method: 'POST',
      body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: receipt.slice(0, 40), notes }),
    });
    return { orderId: order.id, amountPaise: order.amount, currency: 'INR' };
  }
  return { orderId: `order_mock_${randomBytes(9).toString('hex')}`, amountPaise, currency: 'INR' };
}

/** Fetches the payment from the gateway (source of truth), capturing authorized Razorpay payments. */
export async function fetchGatewayPayment(
  provider: 'RAZORPAY' | 'MOCK',
  paymentId: string,
  mockRecord?: { paymentId?: string; status?: string; method?: string; orderId?: string; amountPaise?: number } | null,
): Promise<GatewayPayment> {
  if (provider === 'MOCK') {
    if (!mockRecord || mockRecord.paymentId !== paymentId) throw AppError.badRequest('Payment not found at gateway', ErrorCode.PAYMENT_VERIFICATION_FAILED);
    return {
      id: paymentId,
      orderId: mockRecord.orderId!,
      amountPaise: mockRecord.amountPaise!,
      status: mockRecord.status === 'captured' ? 'captured' : 'failed',
      method: mockRecord.method ?? null,
      raw: { ...mockRecord, mockGateway: true },
    };
  }
  type P = { id: string; order_id: string; amount: number; status: GatewayPayment['status']; method: string; card?: { type?: string } };
  let p = await razorpay<P>(`/payments/${encodeURIComponent(paymentId)}?expand[]=card`);
  const cardType = p.card?.type;
  if (p.status === 'authorized') {
    p = await razorpay<P>(`/payments/${encodeURIComponent(paymentId)}/capture`, { method: 'POST', body: JSON.stringify({ amount: p.amount, currency: 'INR' }) });
  }
  const method = p.method === 'card' && cardType ? `card:${cardType}` : p.method;
  return { id: p.id, orderId: p.order_id, amountPaise: p.amount, status: p.status, method, raw: { id: p.id, status: p.status, method, amount: p.amount } };
}

export function activePaymentProvider(): 'RAZORPAY' | 'MOCK' {
  return env.PAYMENT_PROVIDER === 'razorpay' ? 'RAZORPAY' : 'MOCK';
}

/** Maps gateway method (+ card type when known) to our enum. "card:debit" / "card:credit" or mock values. */
export function mapMethod(method: string | null | undefined): 'UPI' | 'NETBANKING' | 'CARD' | 'DEBIT_CARD' | 'CREDIT_CARD' | 'OTHER' {
  switch ((method ?? '').toLowerCase()) {
    case 'upi':
      return 'UPI';
    case 'netbanking':
      return 'NETBANKING';
    case 'card:debit':
    case 'debit_card':
      return 'DEBIT_CARD';
    case 'card:credit':
    case 'credit_card':
      return 'CREDIT_CARD';
    case 'card':
      return 'CARD';
    default:
      return 'OTHER';
  }
}

export { toHex };
