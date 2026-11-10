import { prisma } from '../../lib/prisma';
import { notifyTransporter } from '../notifications/notification.service';
import { getSettings } from '../settings/settings.service';
import { bookingWindow, compatible, fleetForMatching } from './matching.service';

type AlertPrefs = { newBookings?: boolean; minFreight?: number | null } | null;

/** Tells each transporter that could actually serve a new booking, honouring their booking-alert preferences. */
export async function alertTransporters(bookingId: string) {
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: { requirement: true, product: { select: { requiresSpecialApproval: true } }, locations: { select: { type: true, state: true, city: true } } } });
  if (!b) return;
  const s = await getSettings();
  const pickup = b.locations.find((l) => l.type === 'PICKUP');
  const drop = b.locations.find((l) => l.type === 'DELIVERY');
  const agencies = await prisma.agency.findMany({ where: { verificationStatus: 'APPROVED', isDemo: b.isDemo }, select: { id: true, serviceStates: true, bookingAlertPrefs: true }, take: 2000 });
  const window = bookingWindow(b, s);
  for (const a of agencies) {
    const prefs = a.bookingAlertPrefs as AlertPrefs;
    if (prefs?.newBookings === false || (prefs?.minFreight && b.customerOffer.toNumber() < prefs.minFreight)) continue;
    if (s.marketplaceMatchOperatingStates && a.serviceStates.length && pickup?.state && !a.serviceStates.some((x) => x.toLowerCase() === pickup.state!.toLowerCase())) continue;
    if (compatible(await fleetForMatching(a.id), b, window).length === 0) continue;
    await notifyTransporter(a.id, { type: 'NEW_BOOKING_AVAILABLE', title: `New booking: ${pickup?.city} to ${drop?.city}`, message: `${b.bookingCode} offers Rs ${b.customerOffer.toNumber().toLocaleString('en-IN')}.`, bookingId, link: `/transporter/marketplace/${bookingId}` });
  }
}

const WINDOW_DAYS = 30;
const REPEAT_DAYS = 7;

/** Warns about tanker documents and driver licences expiring within 30 days, at most weekly for each item. */
export async function sweepExpiringDocuments() {
  const until = new Date(Date.now() + WINDOW_DAYS * 86400_000);
  const since = new Date(Date.now() - REPEAT_DAYS * 86400_000);
  const [tankers, drivers] = await Promise.all([
    prisma.tanker.findMany({ where: { isDemo: false, status: { not: 'INACTIVE' }, OR: [{ insuranceExpiry: { lte: until } }, { fitnessExpiry: { lte: until } }, { permitExpiry: { lte: until } }, { pucExpiry: { lte: until } }, { pesoExpiry: { lte: until } }] }, select: { transporterId: true, registrationNumber: true, insuranceExpiry: true, fitnessExpiry: true, permitExpiry: true, pucExpiry: true, pesoExpiry: true } }),
    prisma.driver.findMany({ where: { isDemo: false, isActive: true, licenceExpiry: { lte: until } }, select: { agencyId: true, licenceExpiry: true, user: { select: { fullName: true } } } }),
  ]);
  const items = [
    ...tankers.flatMap((t) => (['Insurance', 'Fitness', 'Permit', 'PUC', 'PESO'] as const).map((label, i) => ({ transporterId: t.transporterId, subject: t.registrationNumber, label, date: [t.insuranceExpiry, t.fitnessExpiry, t.permitExpiry, t.pucExpiry, t.pesoExpiry][i] }))),
    ...drivers.map((d) => ({ transporterId: d.agencyId, subject: d.user.fullName, label: 'Licence', date: d.licenceExpiry as Date | null })),
  ].filter((x) => x.date && x.date <= until);
  for (const x of items) {
    const title = `${x.label} expiring: ${x.subject}`;
    const recent = await prisma.notification.count({ where: { type: 'DOCUMENT_EXPIRY', title, createdAt: { gte: since }, user: { memberships: { some: { agencyId: x.transporterId } } } } });
    if (recent) continue;
    await notifyTransporter(x.transporterId, { type: 'DOCUMENT_EXPIRY', title, message: `${x.label} for ${x.subject} ${x.date! < new Date() ? 'has expired' : `expires on ${x.date!.toISOString().slice(0, 10)}`}.`, link: '/transporter/fleet' });
  }
}
