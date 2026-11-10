import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { logger } from '../../lib/logger';
import { authenticateUser } from '../../middleware/auth';
import { requireCompany } from '../../middleware/company';
import { validateRequest } from '../../middleware/validate';
import { AppError } from '../../utils/errors';
import { created, ok } from '../../utils/response';
import { sendPdf } from '../bookings/booking.routes';
import { idParam, ids } from '../company/company.routes';
import { receiptPdf } from '../documents/document.service';
import { verifyWebhookSignature } from './payment.gateway';
import * as payments from './payment.service';

export const paymentsRouter = Router();
paymentsRouter.use(authenticateUser);

const read = requireCompany({ permission: 'company:payments:read' });
const pay = requireCompany({ permission: 'company:payments:pay' });

paymentsRouter.get('/summary', read, async (req: Request, res: Response) => {
  ok(res, 'Payment summary', await payments.paymentSummary(req.company!.id));
});

paymentsRouter.get('/', read, async (req: Request, res: Response) => {
  const q = z.object({ bookingId: z.string().uuid().optional(), status: z.enum(['CREATED', 'PAID', 'FAILED', 'REFUND_PENDING', 'REFUNDED']).optional() }).catch({}).parse(req.query);
  ok(res, 'Payments', { payments: await payments.listPayments(req.company!.id, q) });
});

paymentsRouter.post(
  '/create-order',
  pay,
  validateRequest({ body: z.object({ bookingId: z.string().uuid(), purpose: z.enum(['ADVANCE', 'BALANCE', 'FULL']) }).strict() }),
  async (req: Request, res: Response) => {
    const { companyId, userId } = ids(req);
    created(res, 'Payment order created', { order: await payments.createOrder(companyId, userId, req.body, req) });
  },
);

paymentsRouter.post(
  '/verify',
  pay,
  validateRequest({
    body: z
      .object({ orderId: z.string().trim().min(5).max(60), paymentId: z.string().trim().min(5).max(60), signature: z.string().trim().min(10).max(200) })
      .strict(),
  }),
  async (req: Request, res: Response) => {
    const { companyId, userId } = ids(req);
    ok(res, 'Payment verified', { payment: await payments.verifyPayment(companyId, userId, req.body, req) });
  },
);

paymentsRouter.post(
  '/failed',
  pay,
  validateRequest({ body: z.object({ orderId: z.string().trim().min(5).max(60), reason: z.string().trim().max(300).optional() }).strict() }),
  async (req: Request, res: Response) => {
    const { companyId, userId } = ids(req);
    ok(res, 'Payment marked as not completed', { payment: await payments.markOrderFailed(companyId, userId, req.body) });
  },
);

/** DEVELOPMENT ONLY: hosted-checkout simulator (PAYMENT_PROVIDER=mock). */
paymentsRouter.post(
  '/mock/checkout',
  pay,
  validateRequest({
    body: z.object({ orderId: z.string().min(5).max(60), outcome: z.enum(['success', 'failure']), method: z.enum(['upi', 'netbanking', 'debit_card', 'credit_card']) }).strict(),
  }),
  async (req: Request, res: Response) => {
    ok(res, 'Simulated gateway response', await payments.mockCheckout(req.company!.id, req.body));
  },
);

paymentsRouter.get('/:id', read, idParam, async (req: Request, res: Response) => {
  ok(res, 'Payment', { payment: await payments.getPayment(req.company!.id, String(req.params.id)) });
});

paymentsRouter.get('/:id/receipt.pdf', read, idParam, async (req: Request, res: Response) => {
  sendPdf(res, await receiptPdf(req.company!.id, String(req.params.id)), req.query.inline === '1');
});

/**
 * Razorpay webhook. Mounted with a raw-body parser (signature is computed over the exact bytes) and
 * without session auth - authenticity comes from the HMAC signature only.
 */
export async function razorpayWebhook(req: Request, res: Response) {
  const raw = req.body as Buffer;
  if (!Buffer.isBuffer(raw) || !verifyWebhookSignature(raw, req.headers['x-razorpay-signature'] as string | undefined)) {
    throw AppError.unauthorized('Invalid webhook signature');
  }
  const event = JSON.parse(raw.toString('utf8'));
  const result = await payments.handleRazorpayWebhook(event);
  logger.info({ event: event.event, handled: result.handled }, 'Razorpay webhook');
  ok(res, 'ok', result);
}
