import { Router, type Request, type RequestHandler, type Response } from 'express';
import { portalEnabled } from '../../config/portals';
import { prisma } from '../../lib/prisma';
import { loginLimiter, otpLimiter } from '../../middleware/rateLimit';
import { validateRequest } from '../../middleware/validate';
import { AppError } from '../../utils/errors';
import { ok } from '../../utils/response';
import { hasPermission } from '../admin/core';
import { audit } from '../audit/audit';
import * as c from '../auth/auth.controller';
import { loginSchema, loginOtpSendSchema, loginOtpVerifySchema, forgotPasswordSchema, refreshSchema } from '../auth/auth.schemas';
import { loginEmployee, loginWithOtp, sendLoginOtp } from '../auth/auth.service';
import { requestContext } from '../auth/context';
import { member } from './common';
import { crmRouter } from './crm.routes';
import { onboardingRouter } from './onboarding.routes';
import { opsRouter } from './ops.routes';
import { verificationRouter } from './verification.routes';
import { workRouter } from './work.routes';

const portalOpen: RequestHandler = (_req, _res, next) => (portalEnabled('employee') ? next() : next(AppError.notFound('Employee portal is not enabled')));

export const employeeRouter = Router();

// ---- Authentication (no self-registration route exists) ----------------------------------------

employeeRouter.post('/auth/login', loginLimiter, portalOpen, validateRequest({ body: loginSchema }), async (req: Request, res: Response) => {
  const result = await loginEmployee(req.body, { ...requestContext(req, req.body.deviceInfo), persistent: req.body.rememberMe ?? true });
  await audit({ action: 'employee.login', entityType: 'user', entityId: result.user.id, actorUserId: result.user.id, actorType: 'EMPLOYEE', module: 'employees', req });
  return c.sendAuthResult(req, res, result, 'Signed in');
});
employeeRouter.post('/auth/otp/send', otpLimiter, portalOpen, validateRequest({ body: loginOtpSendSchema }), async (req: Request, res: Response) => {
  ok(res, 'If this number is registered, a code has been sent', await sendLoginOtp(req.body.phone, req.ip ?? null));
});
employeeRouter.post('/auth/otp/verify', loginLimiter, portalOpen, validateRequest({ body: loginOtpVerifySchema }), async (req: Request, res: Response) => {
  const result = await loginWithOtp(req.body, { ...requestContext(req, req.body.deviceInfo), persistent: req.body.rememberMe ?? true }, 'employee');
  await audit({ action: 'employee.login', entityType: 'user', entityId: result.user.id, actorUserId: result.user.id, actorType: 'EMPLOYEE', module: 'employees', metadata: { method: 'OTP' }, req });
  return c.sendAuthResult(req, res, result, 'Signed in');
});
employeeRouter.post('/auth/forgot-password', otpLimiter, portalOpen, validateRequest({ body: forgotPasswordSchema }), c.forgotPassword);
employeeRouter.post('/auth/logout', validateRequest({ body: refreshSchema }), c.logout);


/** Sidebar entries the caller may see. The API enforces the same permissions independently. */
const NAV: [string, Parameters<typeof hasPermission>[1]][] = [['leads', 'leads'], ['companies', 'companies'], ['transporters', 'transporters'], ['drivers', 'drivers'], ['fleet-verification', 'documents'], ['bookings', 'bookings'], ['negotiations', 'offers'], ['trips', 'trips'], ['support', 'complaints'], ['payments', 'payments'], ['team-attendance', 'attendance'], ['leave-approvals', 'leave'], ['team-mis', 'mis']];

employeeRouter.get('/auth/profile', ...member, async (req: Request, res: Response) => {
  const e = await prisma.employee.findUniqueOrThrow({
    where: { id: req.admin!.employeeId! },
    select: { employeeCode: true, designation: true, department: true, joiningDate: true, employmentType: true, employmentStatus: true, branch: true, territory: true, role: { select: { code: true, name: true, dataScope: true } }, reportingManager: { select: { employeeCode: true, user: { select: { fullName: true } } } }, user: { select: { fullName: true, phone: true, email: true, lastLoginAt: true } } },
  });
  ok(res, 'Employee', { employee: e, modules: NAV.filter(([, m]) => hasPermission(req, m, 'view')).map(([k]) => k), permissions: req.auth!.principal.permissions.filter((k) => k.startsWith('adm.')) });
});

// ---- Role-based dashboard: every figure is a live count ------------------------------------------

const istDay = () => new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())}T00:00:00+05:30`);

employeeRouter.use(crmRouter, onboardingRouter, verificationRouter, opsRouter, workRouter);

employeeRouter.get('/dashboard', ...member, async (req: Request, res: Response) => {
  const empId = req.admin!.employeeId!;
  const uid = req.admin!.userId;
  const today = istDay();
  const tomorrow = new Date(today.getTime() + 86400_000);
  const month = new Date(new Date(today.getTime() + 5.5 * 3600_000).toISOString().slice(0, 7) + '-01T00:00:00+05:30');
  const can = (m: Parameters<typeof hasPermission>[1]) => hasPermission(req, m, 'view');
  const myLeads = { assignedEmployeeId: empId, deletedAt: null };
  const [assignedLeads, todaysFollowUps, pendingTasks, completedTasks, activities, registered, verified] = await Promise.all([
    prisma.lead.count({ where: myLeads }),
    prisma.followUp.count({ where: { employeeId: empId, status: 'PENDING', dueAt: { gte: today, lt: tomorrow } } }),
    prisma.employeeTask.count({ where: { assigneeId: empId, status: { notIn: ['DONE', 'CANCELLED'] } } }),
    prisma.employeeTask.count({ where: { assigneeId: empId, status: 'DONE' } }),
    prisma.leadActivity.count({ where: { actorId: uid, createdAt: { gte: month } } }),
    prisma.lead.count({ where: { ...myLeads, convertedAt: { gte: month } } }),
    prisma.lead.count({ where: { ...myLeads, status: { in: ['VERIFIED', 'ACTIVE', 'FIRST_BOOKING'] } } }),
  ]);
  const sections: Record<string, Record<string, number>> = {};
  if (can('leads')) {
    const [newLeads, calls, connected, interested, due] = await Promise.all([
      prisma.lead.count({ where: { ...myLeads, status: 'NEW' } }),
      prisma.leadActivity.count({ where: { actorId: uid, type: 'CALL', createdAt: { gte: month } } }),
      prisma.leadActivity.count({ where: { actorId: uid, type: 'CALL', connected: true, createdAt: { gte: month } } }),
      prisma.lead.count({ where: { ...myLeads, status: 'INTERESTED' } }),
      prisma.followUp.count({ where: { employeeId: empId, status: 'PENDING', dueAt: { lt: tomorrow } } }),
    ]);
    sections.sales = { totalLeadsAssigned: assignedLeads, newLeads, callsMade: calls, connectedCalls: connected, interestedLeads: interested, followUpsDue: due, verifiedAccounts: verified };
  }
  if (can('bookings') || can('trips')) {
    const [newBookings, pending, activeTrips, completed, noDriver, complaints] = await Promise.all([
      prisma.booking.count({ where: { createdAt: { gte: today } } }),
      prisma.booking.count({ where: { status: { in: ['SEARCHING', 'OFFERS_RECEIVED', 'NEGOTIATION'] } } }),
      prisma.trip.count({ where: { status: { notIn: ['COMPLETED', 'CANCELLED', 'DELIVERED', 'SCHEDULED'] } } }),
      prisma.trip.count({ where: { status: 'COMPLETED', completedAt: { gte: month } } }),
      prisma.trip.count({ where: { status: 'VEHICLE_ASSIGNED', driverId: null } }),
      prisma.supportTicket.count({ where: { status: { notIn: ['RESOLVED', 'CLOSED'] } } }),
    ]);
    sections.operations = { newBookings, pendingBookingActions: pending, activeTrips, completedTrips: completed, pendingDriverAssignments: noDriver, openComplaints: complaints };
  }
  if (can('documents')) {
    const soon = new Date(Date.now() + 30 * 86400_000);
    const [co, tr, dr, ta, ok1, rej, exp] = await Promise.all([
      prisma.company.count({ where: { status: { in: ['PENDING_VERIFICATION', 'UNDER_REVIEW'] } } }),
      prisma.agency.count({ where: { verificationStatus: { in: ['PENDING_VERIFICATION', 'UNDER_REVIEW'] } } }),
      prisma.driver.count({ where: { verificationStatus: { in: ['PENDING_VERIFICATION', 'UNDER_REVIEW'] } } }),
      prisma.tanker.count({ where: { verificationStatus: { in: ['PENDING_VERIFICATION', 'UNDER_REVIEW'] } } }),
      prisma.kycDocument.count({ where: { status: 'VERIFIED', updatedAt: { gte: month } } }),
      prisma.kycDocument.count({ where: { status: 'REJECTED', updatedAt: { gte: month } } }),
      prisma.kycDocument.count({ where: { isCurrent: true, expiryDate: { lte: soon } } }),
    ]);
    sections.verification = { pendingCompanyKyc: co, pendingTransporterKyc: tr, pendingDriverVerification: dr, pendingTankerVerification: ta, documentsApproved: ok1, documentsRejected: rej, documentsExpiring: exp };
  }
  if (can('payments')) {
    const [due, received, refunds, settle] = await Promise.all([
      prisma.invoice.aggregate({ where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] } }, _sum: { totalAmount: true } }),
      prisma.payment.aggregate({ where: { status: 'PAID', paidAt: { gte: month } }, _sum: { amount: true } }),
      prisma.refundRequest.count({ where: { status: 'REQUESTED' } }),
      prisma.settlement.count({ where: { status: { in: ['PENDING', 'ON_HOLD'] } } }),
    ]);
    sections.accounts = { pendingCollections: due._sum.totalAmount?.toNumber() ?? 0, paymentsReceived: received._sum.amount?.toNumber() ?? 0, refundRequests: refunds, pendingSettlements: settle };
  }
  if (can('complaints')) {
    const [fresh, mine, pending, resolved] = await Promise.all([
      prisma.supportTicket.count({ where: { status: 'OPEN' } }),
      prisma.supportTicket.count({ where: { assignedEmployeeId: empId, status: { notIn: ['RESOLVED', 'CLOSED'] } } }),
      prisma.supportTicket.count({ where: { status: { notIn: ['RESOLVED', 'CLOSED'] } } }),
      prisma.supportTicket.count({ where: { status: 'RESOLVED', resolvedAt: { gte: month } } }),
    ]);
    sections.support = { newComplaints: fresh, assignedTickets: mine, pendingTickets: pending, resolvedTickets: resolved };
  }
  ok(res, 'Dashboard', { common: { assignedLeads, todaysFollowUps, pendingTasks, completedTasks, newRegistrations: registered, verifiedRegistrations: verified, totalActivities: activities }, sections });
});

