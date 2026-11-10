import { Router, type Request, type Response } from 'express';
import { authenticateUser } from '../../middleware/auth';
import { requireCompany } from '../../middleware/company';
import { validateRequest } from '../../middleware/validate';
import { created, ok } from '../../utils/response';
import { idParam, ids } from '../company/company.routes';
import { bookingConfirmationPdf, bookingSummaryPdf } from '../documents/document.service';
import { listBookingOffers } from '../offers/offer.service';
import { paymentBreakdown } from '../payments/payment.service';
import { prisma } from '../../lib/prisma';
import * as s from './booking.schemas';
import * as bookings from './booking.service';

export const bookingsRouter = Router();
bookingsRouter.use(authenticateUser);

const read = requireCompany({ permission: 'company:bookings:read' });
const manage = requireCompany({ permission: 'company:bookings:manage' });

export function sendPdf(res: Response, pdf: { buffer: Buffer; fileName: string }, inline: boolean) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${pdf.fileName}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pdf.buffer);
}

bookingsRouter.post(
  '/',
  requireCompany({ permission: 'company:bookings:manage', bookable: true }),
  validateRequest({ body: s.createBookingSchema }),
  async (req: Request, res: Response) => {
    const { companyId, userId } = ids(req);
    // Optional link to the booking this one repeats (only if it belongs to the same company).
    const repeatOf = typeof req.query.repeatOf === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.repeatOf) ? req.query.repeatOf : undefined;
    const owned = repeatOf ? await prisma.booking.findFirst({ where: { id: repeatOf, companyId }, select: { id: true } }) : null;
    const booking = await bookings.createBooking(companyId, userId, req.body, req, { repeatedFromId: owned?.id });
    created(res, 'Booking created. Searching for transporters.', { booking });
  },
);

bookingsRouter.post('/quote', requireCompany({ permission: 'company:bookings:read' }), validateRequest({ body: s.estimateSchema }), async (req: Request, res: Response) => {
  const q = await bookings.quote(req.body);
  ok(res, 'Freight estimate', {
    provider: q.routes.provider,
    providerLabel: q.routes.providerLabel,
    routes: q.routes.routes,
    selectedRoute: q.route,
    estimate: q.estimate,
    product: { id: q.product.id, name: q.product.name },
  });
});

bookingsRouter.get('/', read, validateRequest({ query: s.listBookingsSchema }), async (req: Request, res: Response) => {
  ok(res, 'Bookings', await bookings.listBookings(req.company!.id, res.locals.query));
});

bookingsRouter.get('/:id', read, idParam, async (req: Request, res: Response) => {
  ok(res, 'Booking', { booking: await bookings.getBooking(req.company!.id, String(req.params.id)) });
});

bookingsRouter.put('/:id', manage, idParam, validateRequest({ body: s.updateBookingSchema }), async (req: Request, res: Response) => {
  const { companyId, userId } = ids(req);
  ok(res, 'Booking updated', { booking: await bookings.updateBooking(companyId, userId, String(req.params.id), req.body, req) });
});

bookingsRouter.post('/:id/cancel', manage, idParam, validateRequest({ body: s.cancelBookingSchema }), async (req: Request, res: Response) => {
  const { companyId, userId } = ids(req);
  ok(res, 'Booking cancelled', { booking: await bookings.cancelBooking(companyId, userId, String(req.params.id), req.body.reason, req) });
});

/** Returns a pre-filled booking draft; the company reviews it and submits a new booking. */
bookingsRouter.post('/:id/repeat', manage, idParam, async (req: Request, res: Response) => {
  ok(res, 'Booking template', { template: await bookings.repeatTemplate(req.company!.id, String(req.params.id)) });
});

bookingsRouter.get('/:id/offers', read, idParam, async (req: Request, res: Response) => {
  ok(res, 'Offers', { offers: await listBookingOffers(req.company!.id, String(req.params.id)) });
});

bookingsRouter.get('/:id/summary.pdf', read, idParam, async (req: Request, res: Response) => {
  sendPdf(res, await bookingSummaryPdf(req.company!.id, String(req.params.id)), req.query.inline === '1');
});

bookingsRouter.get('/:id/confirmation.pdf', read, idParam, async (req: Request, res: Response) => {
  sendPdf(res, await bookingConfirmationPdf(req.company!.id, String(req.params.id)), req.query.inline === '1');
});

bookingsRouter.get('/:id/payment', requireCompany({ permission: 'company:payments:read' }), idParam, async (req: Request, res: Response) => {
  ok(res, 'Payment details', await paymentBreakdown(req.company!.id, String(req.params.id)));
});
