import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { portalEnabled } from '../../config/portals';
import { round2 } from '../../lib/money';
import { prisma } from '../../lib/prisma';
import { authenticateUser } from '../../middleware/auth';
import { registrationLimiter, otpLimiter } from '../../middleware/rateLimit';
import { requireTransporter } from '../../middleware/transporter';
import { multipart, sendStoredFile } from '../../middleware/upload';
import { validateRequest } from '../../middleware/validate';
import { encryptField } from '../../utils/crypto';
import { AppError } from '../../utils/errors';
import { created, ok } from '../../utils/response';
import { phoneSchema, pincodeSchema } from '../../utils/validators';
import { audit } from '../audit/audit';
import { registerTransporter } from '../auth/auth.service';
import { registerTransporterSchema } from '../auth/auth.schemas';
import { requestContext } from '../auth/context';
import { sendAuthResult } from '../auth/auth.controller';
import { sendOtp, verifyAndConsumeOtp } from '../otp/otp.service';
import { ACTIVE_TRIP } from '../trips/trip.service';
import { idParam, listKyc, saveKycDocument, tid, uid } from './common';
import { marketplaceBookings } from './marketplace.routes';

export const transporterMeRouter = Router();

export const TRANSPORTER_DOC_TYPES = ['BUSINESS_REGISTRATION', 'GST_CERTIFICATE', 'PAN_DOCUMENT', 'TRANSPORT_PERMIT', 'OTHER'] as const;

transporterMeRouter.post(
  '/register',
  registrationLimiter,
  (_req, _res, next) => (portalEnabled('transporter') ? next() : next(AppError.notFound('This registration is not available'))),
  validateRequest({ body: registerTransporterSchema }),
  async (req: Request, res: Response) => {
    const result = await registerTransporter(req.body, { ...requestContext(req, req.body.deviceInfo), persistent: true });
    sendAuthResult(req, res, result, 'Registration successful. Your Transporter ID is ' + result.transporter.transporterCode, 201);
  },
);

const member = [authenticateUser, requireTransporter()];

const shapeProfile = (a: NonNullable<Awaited<ReturnType<typeof loadProfile>>>) => ({
  ...a,
  rating: a.rating.toNumber(),
  bank: a.bankAccounts[0] ?? null,
  bankAccounts: undefined,
});

function loadProfile(id: string) {
  return prisma.agency.findUnique({
    where: { id },
    select: {
      id: true, transporterCode: true, companyName: true, gstNumber: true, panNumber: true, businessType: true, address: true, operationalAddress: true, city: true, state: true, pincode: true,
      verificationStatus: true, rejectionReason: true, suspensionReason: true, verifiedAt: true, rating: true, completedTrips: true, isDemo: true, category: true,
      serviceStates: true, operatingCities: true, preferredRoutes: true, declaredTankers: true, capacityCategories: true, productCategories: true, bookingAlertPrefs: true, createdAt: true,
      owner: { select: { fullName: true, phone: true, email: true, isPhoneVerified: true, isEmailVerified: true } },
      contacts: { orderBy: { createdAt: 'asc' } },
      // Only the masked account number ever leaves the server.
      bankAccounts: { where: { isCurrent: true }, select: { id: true, accountHolder: true, bankName: true, accountLast4: true, ifsc: true, accountType: true, status: true, createdAt: true } },
    },
  });
}

transporterMeRouter.get('/me', ...member, async (req, res) => {
  const a = await loadProfile(tid(req));
  ok(res, 'Transporter profile', { transporter: shapeProfile(a!), documents: await listKyc('TRANSPORTER', tid(req)) });
});

// GST / PAN / company name are verified identity: they change only through support and re-verification.
const profileSchema = z
  .object({
    ownerName: z.string().trim().min(2).max(120),
    businessType: z.string().trim().max(40),
    address: z.string().trim().min(5).max(300),
    operationalAddress: z.string().trim().max(300),
    city: z.string().trim().min(2).max(80),
    state: z.string().trim().min(2).max(80),
    pincode: pincodeSchema,
    operatingCities: z.array(z.string().trim().min(2).max(80)).max(100),
    serviceStates: z.array(z.string().trim().min(2).max(80)).max(40),
    preferredRoutes: z.array(z.string().trim().min(3).max(120)).max(100),
    capacityCategories: z.array(z.string().trim().max(20)).max(30),
    productCategories: z.array(z.string().trim().max(40)).max(50),
  })
  .partial()
  .strict();

const manageProfile = [authenticateUser, requireTransporter({ permission: 'agency:update' })];

transporterMeRouter.put('/me', ...manageProfile, validateRequest({ body: profileSchema }), async (req: Request, res: Response) => {
  const { ownerName, ...data } = req.body as z.infer<typeof profileSchema>;
  const before = await prisma.agency.findUniqueOrThrow({ where: { id: tid(req) }, select: { ownerId: true, address: true, city: true, state: true } });
  await prisma.$transaction(async (tx) => {
    await tx.agency.update({ where: { id: tid(req) }, data });
    if (ownerName) await tx.user.update({ where: { id: before.ownerId }, data: { fullName: ownerName } });
    await audit({ action: 'transporter.profile_updated', entityType: 'transporter', entityId: tid(req), actorType: 'TRANSPORTER', actorUserId: uid(req), newValue: req.body, req }, tx);
  });
  ok(res, 'Profile saved', { transporter: shapeProfile((await loadProfile(tid(req)))!) });
});

transporterMeRouter.post('/me/documents', ...manageProfile, multipart({ field: 'file' }), async (req: Request, res: Response) => {
  const document = await saveKycDocument(req, { type: 'TRANSPORTER', id: tid(req), transporterId: tid(req) }, TRANSPORTER_DOC_TYPES);
  created(res, 'Document uploaded', { document: { id: document.id, docType: document.docType, status: document.status } });
});

transporterMeRouter.get('/me/documents/:id/download', ...member, idParam, async (req: Request, res: Response) => {
  const d = await prisma.kycDocument.findFirst({ where: { id: String(req.params.id), ownerType: 'TRANSPORTER', ownerId: tid(req) } });
  if (!d) throw AppError.notFound('Document not found');
  sendStoredFile(res, d, req.query.inline === '1');
});

transporterMeRouter.get('/me/verification', ...member, async (req, res) => {
  const [agency, documents, rules] = await Promise.all([
    prisma.agency.findUniqueOrThrow({ where: { id: tid(req) }, select: { verificationStatus: true, rejectionReason: true, suspensionReason: true, verifiedAt: true } }),
    listKyc('TRANSPORTER', tid(req)),
    prisma.complianceRule.findMany({ where: { ownerType: 'TRANSPORTER', isActive: true, isMandatory: true }, select: { docType: true, description: true } }),
  ]);
  const have = new Set(documents.map((d) => d.docType));
  ok(res, 'Verification', { ...agency, documents, missing: rules.filter((r) => !have.has(r.docType)), canBid: agency.verificationStatus === 'APPROVED' });
});

// ---- Contacts ------------------------------------------------------------------------------

const contactSchema = z.object({ name: z.string().trim().min(2).max(120), designation: z.string().trim().max(80).optional(), phone: phoneSchema, email: z.string().trim().email().max(254).optional().or(z.literal('').transform(() => undefined)) }).strict();

transporterMeRouter.get('/me/contacts', ...member, async (req, res) => ok(res, 'Contacts', { contacts: await prisma.transporterContact.findMany({ where: { transporterId: tid(req) }, orderBy: { createdAt: 'asc' } }) }));
transporterMeRouter.post('/me/contacts', ...manageProfile, validateRequest({ body: contactSchema }), async (req: Request, res: Response) => {
  created(res, 'Contact added', { contact: await prisma.transporterContact.create({ data: { ...req.body, transporterId: tid(req) } }) });
});
transporterMeRouter.delete('/me/contacts/:id', ...manageProfile, idParam, async (req: Request, res: Response) => {
  const r = await prisma.transporterContact.deleteMany({ where: { id: String(req.params.id), transporterId: tid(req), isPrimary: false } });
  if (r.count === 0) throw AppError.notFound('Contact not found or is the primary contact');
  ok(res, 'Contact removed', null);
});

// ---- Bank details: OTP to the owner's mobile, new row pending re-verification, audited --------

const manageBank = [authenticateUser, requireTransporter({ permission: 'agency:bank:manage' })];

transporterMeRouter.post('/me/bank/send-otp', otpLimiter, ...manageBank, async (req: Request, res: Response) => {
  const owner = await prisma.agency.findUniqueOrThrow({ where: { id: tid(req) }, select: { owner: { select: { phone: true } } } });
  const r = await sendOtp({ destination: owner.owner.phone, channel: 'SMS', purpose: 'BANK_CHANGE', ip: req.ip ?? null });
  ok(res, 'Code sent to the registered mobile number', { sent: true, ...(r.devCode ? { devCode: r.devCode } : {}) });
});

const bankSchema = z
  .object({
    accountHolder: z.string().trim().min(2).max(120),
    bankName: z.string().trim().min(2).max(120),
    accountNumber: z.string().trim().regex(/^\d{9,18}$/, 'Enter a valid account number'),
    ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC'),
    accountType: z.enum(['SAVINGS', 'CURRENT']),
    code: z.string().trim().regex(/^\d{4,8}$/),
  })
  .strict();

transporterMeRouter.put('/me/bank', otpLimiter, ...manageBank, validateRequest({ body: bankSchema }), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof bankSchema>;
  const owner = await prisma.agency.findUniqueOrThrow({ where: { id: tid(req) }, select: { owner: { select: { phone: true } } } });
  const account = await prisma.$transaction(async (tx) => {
    await verifyAndConsumeOtp(owner.owner.phone, 'BANK_CHANGE', b.code, tx);
    const previous = await tx.transporterBankAccount.findFirst({ where: { transporterId: tid(req), isCurrent: true }, select: { id: true, accountLast4: true, ifsc: true } });
    if (previous) await tx.transporterBankAccount.update({ where: { id: previous.id }, data: { isCurrent: false } });
    const row = await tx.transporterBankAccount.create({
      data: { transporterId: tid(req), accountHolder: b.accountHolder, bankName: b.bankName, accountNumberEnc: encryptField(b.accountNumber), accountLast4: b.accountNumber.slice(-4), ifsc: b.ifsc, accountType: b.accountType, createdById: uid(req) },
      select: { id: true, accountHolder: true, bankName: true, accountLast4: true, ifsc: true, accountType: true, status: true },
    });
    await audit({ action: 'transporter.bank_changed', entityType: 'transporter', entityId: tid(req), actorType: 'TRANSPORTER', actorUserId: uid(req), previousValue: previous ? { last4: previous.accountLast4, ifsc: previous.ifsc } : undefined, newValue: { last4: row.accountLast4, ifsc: row.ifsc }, req }, tx);
    return row;
  });
  ok(res, 'Bank details saved and sent for verification', { bank: account });
});

transporterMeRouter.put('/me/preferences', ...manageProfile, validateRequest({ body: z.object({ bookingAlerts: z.object({ newBookings: z.boolean(), expiring: z.boolean(), minFreight: z.number().min(0).max(100_000_000).nullable() }).strict() }).strict() }), async (req: Request, res: Response) => {
  await prisma.agency.update({ where: { id: tid(req) }, data: { bookingAlertPrefs: req.body.bookingAlerts } });
  ok(res, 'Preferences saved', { bookingAlerts: req.body.bookingAlerts });
});

// ---- Dashboard -----------------------------------------------------------------------------

const iso = (d: Date) => d.toISOString().slice(0, 7);

transporterMeRouter.get('/dashboard', ...member, async (req, res) => {
  const t = tid(req);
  const monthStart = new Date(new Date().toISOString().slice(0, 7) + '-01T00:00:00Z');
  const yearAgo = new Date(Date.UTC(monthStart.getUTCFullYear() - 1, monthStart.getUTCMonth() + 1, 1));
  const soon = new Date(Date.now() + 30 * 86400_000);
  const [tankers, activeDrivers, offers, confirmed, activeTrips, completed, commissions, pending, notifications, drivers] = await Promise.all([
    prisma.tanker.findMany({ where: { transporterId: t }, select: { id: true, status: true, registrationNumber: true, insuranceExpiry: true, fitnessExpiry: true, permitExpiry: true, pucExpiry: true, pesoExpiry: true } }),
    prisma.driver.count({ where: { agencyId: t, isActive: true, verificationStatus: 'APPROVED' } }),
    prisma.transporterOffer.groupBy({ by: ['status'], where: { transporterId: t }, _count: true }),
    prisma.bookingAllocation.count({ where: { transporterId: t, status: { in: ['CONFIRMED', 'IN_PROGRESS'] } } }),
    prisma.trip.findMany({
      where: { transporterId: t, status: { in: ACTIVE_TRIP } },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, tripCode: true, status: true, etaAt: true, exception: true, isSimulated: true, tanker: { select: { registrationNumber: true } }, driver: { select: { user: { select: { fullName: true } } } }, booking: { select: { locations: { select: { type: true, city: true } } } } },
    }),
    prisma.trip.count({ where: { transporterId: t, status: 'COMPLETED' } }),
    prisma.bookingCommission.findMany({ where: { transporterId: t, computedAt: { gte: yearAgo } }, select: { freightAmount: true, computedAt: true } }),
    prisma.settlement.aggregate({ where: { transporterId: t, status: { in: ['PENDING', 'ON_HOLD', 'PROCESSING'] } }, _sum: { amount: true } }),
    prisma.notification.findMany({ where: { userId: uid(req) }, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, title: true, message: true, createdAt: true, readAt: true, link: true } }),
    prisma.driver.findMany({ where: { agencyId: t }, select: { id: true, licenceExpiry: true, verificationStatus: true, user: { select: { fullName: true } } } }),
  ]);
  const count = (s: string) => offers.find((o) => o.status === s)?._count ?? 0;
  const activeCount = await prisma.trip.count({ where: { transporterId: t, status: { in: ACTIVE_TRIP } } });
  const months = new Map<string, number>();
  for (let i = 11; i >= 0; i--) months.set(iso(new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - i, 1))), 0);
  for (const c of commissions) {
    const k = iso(c.computedAt);
    if (months.has(k)) months.set(k, round2((months.get(k) ?? 0) + c.freightAmount.toNumber()).toNumber());
  }
  const fleet = tankers.reduce<Record<string, number>>((m, x) => ((m[x.status] = (m[x.status] ?? 0) + 1), m), {});
  const alerts: { kind: string; subject: string; detail: string; date: Date | null }[] = [];
  for (const k of tankers) {
    for (const [label, d] of [['Insurance', k.insuranceExpiry], ['Fitness', k.fitnessExpiry], ['Permit', k.permitExpiry], ['PUC', k.pucExpiry], ['PESO', k.pesoExpiry]] as const) {
      if (d && d <= soon) alerts.push({ kind: 'TANKER', subject: k.registrationNumber, detail: `${label} ${d < new Date() ? 'expired' : 'expiring soon'}`, date: d });
    }
  }
  for (const d of drivers) {
    if (d.licenceExpiry <= soon) alerts.push({ kind: 'DRIVER', subject: d.user.fullName, detail: `Licence ${d.licenceExpiry < new Date() ? 'expired' : 'expiring soon'}`, date: d.licenceExpiry });
    if (d.verificationStatus !== 'APPROVED') alerts.push({ kind: 'DRIVER', subject: d.user.fullName, detail: 'Verification pending', date: null });
  }
  const market = req.transporter!.status === 'APPROVED' ? await marketplaceBookings(t, {}, 8, 0) : { total: 0, items: [] };
  ok(res, 'Dashboard', {
    verificationStatus: req.transporter!.status,
    cards: {
      totalTankers: tankers.length,
      availableTankers: fleet.AVAILABLE ?? 0,
      bookedTankers: tankers.filter((k) => ['BOOKED', 'RESERVED', 'LOADING', 'IN_TRANSIT', 'UNLOADING', 'ON_TRIP'].includes(k.status)).length,
      activeDrivers,
      newBookingRequests: market.total,
      pendingOffers: count('PENDING') + count('COUNTERED'),
      acceptedOffers: count('ACCEPTED'),
      confirmedBookings: confirmed,
      activeTrips: activeCount,
      completedTrips: completed,
      monthlyFreight: months.get(iso(monthStart)) ?? 0,
      pendingSettlements: pending._sum.amount?.toNumber() ?? 0,
    },
    newBookings: market.items,
    activeTrips: activeTrips.map((x) => ({ ...x, pickup: x.booking.locations.find((l) => l.type === 'PICKUP')?.city, delivery: x.booking.locations.find((l) => l.type === 'DELIVERY')?.city, booking: undefined })),
    earnings: [...months].map(([month, freight]) => ({ month, freight })),
    fleet,
    notifications,
    alerts: alerts.slice(0, 12),
  });
});
