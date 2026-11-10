import type { Prisma } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { storage } from '../../lib/storage';
import { multipart, sendStoredFile, storeUpload } from '../../middleware/upload';
import { AppError, ErrorCode } from '../../utils/errors';
import { created, ok } from '../../utils/response';
import { emailSchema, phoneSchema } from '../../utils/validators';
import { nextCodeRaw } from '../admin/codes';
import { body, can, dateRange, hasPermission, idOf, insensitive, orderBy, parseList, respondList, win, type Column } from '../admin/core';
import { companyCreateSchema, createCompanyOnBehalf, createTransporterOnBehalf, transporterCreateSchema } from '../admin/parties.routes';
import { syncConvertedStatus } from '../admin/people.routes';
import { audit } from '../audit/audit';
import { notifyUser } from '../notifications/notification.service';
import { assertActiveEmployee, empId, isAll, istStart, member, todayIstStr, uid } from './common';
import { registerDriver, driverSchema } from './onboarding.routes';

export const LEAD_STATUSES = ['NEW', 'NOT_CONTACTED', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP', 'MEETING_SCHEDULED', 'REGISTRATION_PENDING', 'REGISTERED', 'VERIFICATION_PENDING', 'VERIFIED', 'FIRST_BOOKING', 'ACTIVE', 'NOT_INTERESTED', 'LOST'] as const;
export const LEAD_SOURCES = ['FIELD_VISIT', 'TELECALLING', 'WEBSITE', 'GOOGLE', 'SOCIAL_MEDIA', 'REFERRAL', 'EXHIBITION', 'EXISTING_CUSTOMER', 'EMPLOYEE_REFERENCE', 'OTHER'] as const;
const FOLLOW_TYPES = ['PHONE_CALL', 'WHATSAPP', 'PHYSICAL_VISIT', 'ONLINE_MEETING', 'EMAIL'] as const;
const OUTCOMES = ['CONNECTED', 'NOT_CONNECTED', 'BUSY', 'SWITCHED_OFF', 'INTERESTED', 'NOT_INTERESTED', 'CALLBACK_REQUESTED', 'MEETING_FIXED', 'REGISTRATION_PROMISED'] as const;

const normName = (s: string) => s.toLowerCase().replace(/\b(pvt|private|ltd|limited|llp|co|company|the|and|&)\b/g, '').replace(/[^a-z0-9]/g, '');
const opt = <T extends z.ZodTypeAny>(s: T) => s.optional().or(z.literal('').transform(() => undefined));

const leadFields = {
  leadType: z.enum(['COMPANY', 'TRANSPORTER', 'DRIVER']),
  name: z.string().trim().min(2).max(160),
  contactPerson: opt(z.string().trim().max(120)),
  phone: phoneSchema,
  whatsapp: opt(phoneSchema),
  email: opt(emailSchema),
  businessType: opt(z.string().trim().max(40)),
  gstNumber: opt(z.string().trim().toUpperCase().max(15)),
  city: opt(z.string().trim().max(80)),
  state: opt(z.string().trim().max(80)),
  address: opt(z.string().trim().max(300)),
  source: z.enum(LEAD_SOURCES),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  nextFollowUpAt: z.coerce.date().optional(),
  remarks: opt(z.string().trim().max(2000)),
};
const createLead = z.object({ ...leadFields, assignedEmployeeId: z.string().uuid().nullable().optional() }).strict();
const updateLead = z.object({ ...leadFields, status: z.enum(LEAD_STATUSES) }).partial().strict();

type DupInput = { leadType?: string; phone?: string; gstNumber?: string; email?: string; name?: string; city?: string };

/** Duplicate check across leads AND existing accounts, so a lead can never shadow a registered business. */
export async function findDuplicates(input: DupInput, excludeId?: string) {
  const nn = input.name ? normName(input.name) : '';
  const or: Prisma.LeadWhereInput[] = [...(input.phone ? [{ phone: input.phone }] : []), ...(input.gstNumber ? [{ gstNumber: input.gstNumber }] : []), ...(input.email ? [{ email: input.email }] : []), ...(nn.length >= 4 && input.city ? [{ normalizedName: nn, city: { equals: input.city, mode: 'insensitive' as const } }] : [])];
  if (!or.length) return { leads: [], accounts: [] };
  const [leads, users, companies, agencies] = await Promise.all([
    prisma.lead.findMany({ where: { deletedAt: null, ...(input.leadType ? { leadType: input.leadType } : {}), id: excludeId ? { not: excludeId } : undefined, OR: or }, take: 5, select: { id: true, leadCode: true, leadType: true, name: true, phone: true, status: true, owner: { select: { user: { select: { fullName: true } } } } } }),
    input.phone || input.email ? prisma.user.findMany({ where: { OR: [...(input.phone ? [{ phone: input.phone }] : []), ...(input.email ? [{ email: input.email }] : [])] }, take: 3, select: { fullName: true } }) : [],
    input.gstNumber ? prisma.company.findMany({ where: { gstNumber: input.gstNumber }, take: 3, select: { name: true, companyCode: true } }) : [],
    input.gstNumber ? prisma.agency.findMany({ where: { gstNumber: input.gstNumber }, take: 3, select: { companyName: true, transporterCode: true } }) : [],
  ]);
  return { leads: leads.map((l) => ({ ...l, owner: l.owner?.user.fullName ?? null })), accounts: [...users.map((u) => `Existing user: ${u.fullName}`), ...companies.map((c) => `Company ${c.companyCode}: ${c.name}`), ...agencies.map((a) => `Transporter ${a.transporterCode}: ${a.companyName}`)] };
}

const scope = (req: Request): Prisma.LeadWhereInput => ({ deletedAt: null, ...(isAll(req) ? {} : { assignedEmployeeId: empId(req) }) });

async function leadOr404(req: Request) {
  const lead = await prisma.lead.findFirst({ where: { id: idOf(req), ...scope(req) } });
  if (!lead) throw AppError.notFound('Lead not found');
  return lead;
}

const columns: Column[] = [['leadCode', 'Lead ID'], ['leadType', 'Category'], ['name', 'Name'], ['phone', 'Mobile'], ['city', 'City'], ['source', 'Source'], ['priority', 'Priority'], ['status', 'Status'], ['owner', 'Assigned']].map(([key, label]) => ({ key, label, format: 'text' as const }));

export const crmRouter = Router();
crmRouter.use(...member);

crmRouter.post('/leads/check-duplicates', can('leads', 'view'), async (req: Request, res: Response) => {
  const input = body(req, z.object({ leadType: z.string().optional(), phone: z.string().optional(), gstNumber: z.string().toUpperCase().optional(), email: z.string().toLowerCase().optional(), name: z.string().optional(), city: z.string().optional() }));
  ok(res, 'Duplicates', await findDuplicates(input));
});

crmRouter.get('/leads', can('leads', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { status: z.string().optional(), leadType: z.string().optional(), mine: z.string().optional() });
  const where: Prisma.LeadWhereInput = {
    ...scope(req),
    ...(q.mine === '1' ? { assignedEmployeeId: empId(req) } : {}),
    ...(q.status ? { status: String(q.status) } : {}),
    ...(q.leadType ? { leadType: String(q.leadType) } : {}),
    ...(q.q ? { OR: [{ name: insensitive(q.q) }, { leadCode: insensitive(q.q) }, { phone: { contains: q.q } }, { city: insensitive(q.q) }] } : {}),
    ...(dateRange(q) ? { createdAt: dateRange(q) } : {}),
  };
  const fetch = (paged: boolean) => prisma.lead.findMany({ where, orderBy: orderBy(q, ['createdAt', 'name', 'status', 'nextFollowUpAt'] as const, 'createdAt'), ...win(q, paged), include: { owner: { select: { user: { select: { fullName: true } } } } } });
  const shape = (rows: Awaited<ReturnType<typeof fetch>>) => rows.map((l) => ({ ...l, owner: l.owner?.user.fullName ?? null }));
  const [total, rows] = await Promise.all([prisma.lead.count({ where }), fetch(true)]);
  await respondList(req, res, { title: 'Leads', q, columns, total, rows: shape(rows), exportRows: async () => shape(await fetch(false)), module: 'leads' });
});

crmRouter.post('/leads', can('leads', 'create'), async (req: Request, res: Response) => {
  const input = body(req, createLead);
  const dups = await findDuplicates(input);
  if (dups.leads.length || dups.accounts.length) throw new AppError(409, ErrorCode.CONFLICT, 'Possible duplicate found', dups);
  const owner = input.assignedEmployeeId !== undefined && hasPermission(req, 'leads', 'assign') ? input.assignedEmployeeId : empId(req);
  const lead = await prisma.$transaction(async (tx) => {
    const l = await tx.lead.create({ data: { ...input, assignedEmployeeId: owner, normalizedName: normName(input.name), leadCode: await nextCodeRaw(tx, 'lead_code_seq', 'LD', 6), createdById: uid(req) } });
    await tx.leadActivity.create({ data: { leadId: l.id, type: 'NOTE', notes: `Lead created from ${input.source.replace(/_/g, ' ').toLowerCase()}`, actorId: uid(req) } });
    if (input.nextFollowUpAt) await tx.followUp.create({ data: { leadId: l.id, employeeId: owner, dueAt: input.nextFollowUpAt, notes: 'Initial follow-up' } });
    await audit({ action: 'lead.created', entityType: 'lead', entityId: l.id, module: 'leads', actorType: 'EMPLOYEE', newValue: { leadCode: l.leadCode, type: l.leadType }, req }, tx);
    return l;
  });
  created(res, `Lead ${lead.leadCode} created`, { lead });
});

crmRouter.get('/leads/:id', can('leads', 'view'), async (req: Request, res: Response) => {
  const l0 = await leadOr404(req);
  await syncConvertedStatus(l0);
  const [lead, activities, followUps, documents] = await Promise.all([
    prisma.lead.findUniqueOrThrow({ where: { id: l0.id }, include: { owner: { select: { id: true, employeeCode: true, user: { select: { fullName: true } } } } } }),
    prisma.leadActivity.findMany({ where: { leadId: l0.id }, orderBy: { createdAt: 'desc' } }),
    prisma.followUp.findMany({ where: { leadId: l0.id }, orderBy: { dueAt: 'desc' } }),
    prisma.leadDocument.findMany({ where: { leadId: l0.id }, orderBy: { createdAt: 'desc' }, select: { id: true, title: true, fileName: true, createdAt: true } }),
  ]);
  ok(res, 'Lead', { lead, activities, followUps, documents });
});

crmRouter.put('/leads/:id', can('leads', 'edit'), async (req: Request, res: Response) => {
  const lead = await leadOr404(req);
  const input = body(req, updateLead);
  if (input.phone || input.gstNumber || input.email) {
    const dups = await findDuplicates({ leadType: lead.leadType, phone: input.phone, gstNumber: input.gstNumber, email: input.email }, lead.id);
    if (dups.leads.length) throw new AppError(409, ErrorCode.CONFLICT, 'Possible duplicate found', dups);
  }
  // Conversion fixes these statuses; they are not hand-editable.
  if (input.status && lead.convertedEntityId && ['NEW', 'CONTACTED', 'INTERESTED'].includes(input.status)) throw AppError.conflict('This lead is already converted');
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.lead.update({ where: { id: lead.id }, data: { ...input, ...(input.name ? { normalizedName: normName(input.name) } : {}) } });
    if (input.status && input.status !== lead.status) await tx.leadActivity.create({ data: { leadId: lead.id, type: 'STATUS_CHANGE', fromValue: lead.status, toValue: input.status, actorId: uid(req) } });
    await audit({ action: 'lead.updated', entityType: 'lead', entityId: lead.id, module: 'leads', actorType: 'EMPLOYEE', previousValue: { status: lead.status }, newValue: input as Prisma.InputJsonValue, req }, tx);
    return u;
  });
  ok(res, 'Lead saved', { lead: updated });
});

crmRouter.post('/leads/:id/assign', can('leads', 'assign'), async (req: Request, res: Response) => {
  const lead = await leadOr404(req);
  const { employeeId, reason } = body(req, z.object({ employeeId: z.string().uuid(), reason: z.string().trim().max(300).optional() }).strict());
  const e = await assertActiveEmployee(employeeId);
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: lead.id }, data: { assignedEmployeeId: employeeId } });
    await tx.followUp.updateMany({ where: { leadId: lead.id, status: 'PENDING' }, data: { employeeId } });
    await tx.leadActivity.create({ data: { leadId: lead.id, type: lead.assignedEmployeeId ? 'TRANSFER' : 'ASSIGNMENT', fromValue: lead.assignedEmployeeId?.slice(0, 80), toValue: e.user.fullName.slice(0, 80), notes: reason, actorId: uid(req) } });
    await audit({ action: 'lead.assigned', entityType: 'lead', entityId: lead.id, module: 'leads', actorType: 'EMPLOYEE', previousValue: { employeeId: lead.assignedEmployeeId }, newValue: { employeeId }, req }, tx);
  });
  await notifyUser(e.userId, { type: 'LEAD_ASSIGNED', title: `Lead ${lead.leadCode} assigned to you`, message: lead.name, link: `/employee/leads/${lead.id}` });
  ok(res, `Lead assigned to ${e.user.fullName}`, null);
});

crmRouter.post('/leads/:id/lost', can('leads', 'edit'), async (req: Request, res: Response) => {
  const lead = await leadOr404(req);
  const { reason } = body(req, z.object({ reason: z.string().trim().min(3).max(300) }).strict());
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: lead.id }, data: { status: 'LOST', lostReason: reason, nextFollowUpAt: null } });
    await tx.followUp.updateMany({ where: { leadId: lead.id, status: 'PENDING' }, data: { status: 'DONE', outcome: 'Lead lost', completedAt: new Date() } });
    await tx.leadActivity.create({ data: { leadId: lead.id, type: 'STATUS_CHANGE', fromValue: lead.status, toValue: 'LOST', notes: reason, actorId: uid(req) } });
    await audit({ action: 'lead.lost', entityType: 'lead', entityId: lead.id, module: 'leads', actorType: 'EMPLOYEE', newValue: { reason }, req }, tx);
  });
  ok(res, 'Lead marked lost', null);
});

crmRouter.post('/leads/:id/documents', can('leads', 'edit'), multipart({ field: 'file' }), async (req: Request, res: Response) => {
  const lead = await leadOr404(req);
  const { title } = z.object({ title: z.string().trim().min(2).max(120) }).strict().parse(req.body ?? {});
  const file = await storeUpload(req.file, 'kyc-documents', ['pdf', 'png', 'jpeg']);
  try {
    const doc = await prisma.leadDocument.create({ data: { leadId: lead.id, title, uploadedById: uid(req), ...file }, select: { id: true, title: true, fileName: true } });
    created(res, 'Document uploaded', { document: doc });
  } catch (e) {
    await storage.remove(file.storageKey);
    throw e;
  }
});

crmRouter.get('/leads/:id/documents/:docId', can('leads', 'view'), async (req: Request, res: Response) => {
  const lead = await leadOr404(req);
  const d = await prisma.leadDocument.findFirst({ where: { id: String(req.params.docId), leadId: lead.id } });
  if (!d) throw AppError.notFound('Document not found');
  sendStoredFile(res, d, req.query.inline === '1');
});

crmRouter.post('/leads/:id/convert', can('leads', 'edit'), async (req: Request, res: Response) => {
  const lead = await leadOr404(req);
  if (lead.convertedEntityId) throw AppError.conflict('This lead is already converted');
  let entity: { id: string; label: string };
  if (lead.leadType === 'COMPANY') {
    if (!hasPermission(req, 'companies', 'create')) throw AppError.forbidden('You cannot register companies');
    const c = await createCompanyOnBehalf(req, body(req, companyCreateSchema));
    entity = { id: c.id, label: c.companyCode };
  } else if (lead.leadType === 'TRANSPORTER') {
    if (!hasPermission(req, 'transporters', 'create')) throw AppError.forbidden('You cannot register transporters');
    const t = await createTransporterOnBehalf(req, body(req, transporterCreateSchema));
    entity = { id: t.id, label: t.transporterCode };
  } else {
    if (!hasPermission(req, 'drivers', 'create')) throw AppError.forbidden('You cannot register drivers');
    const d = await registerDriver(req, body(req, driverSchema));
    entity = { id: d.id, label: d.licenceNumber };
  }
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: lead.id }, data: { status: 'REGISTERED', convertedEntityType: lead.leadType, convertedEntityId: entity.id, convertedAt: new Date(), nextFollowUpAt: null } });
    await tx.followUp.updateMany({ where: { leadId: lead.id, status: 'PENDING' }, data: { status: 'DONE', outcome: 'Converted', completedAt: new Date() } });
    await tx.leadActivity.create({ data: { leadId: lead.id, type: 'CONVERSION', fromValue: lead.status, toValue: 'REGISTERED', notes: `Registered as ${entity.label}`, actorId: uid(req) } });
    await audit({ action: 'lead.converted', entityType: 'lead', entityId: lead.id, module: 'leads', actorType: 'EMPLOYEE', newValue: { entityType: lead.leadType, entityId: entity.id }, req }, tx);
  });
  created(res, `Lead converted: ${entity.label}`, { entityType: lead.leadType, entityId: entity.id });
});

// ---- Call and meeting logs (stored as lead activities) -------------------------------------------

const logSchema = z.object({ leadId: z.string().uuid(), type: z.enum(['CALL', 'MEETING']).default('CALL'), outcome: z.enum(OUTCOMES), durationSeconds: z.number().int().min(0).max(86400).optional(), notes: z.string().trim().max(2000).optional() }).strict();
const CONNECTED = ['CONNECTED', 'INTERESTED', 'NOT_INTERESTED', 'CALLBACK_REQUESTED', 'MEETING_FIXED', 'REGISTRATION_PROMISED'];

crmRouter.post('/call-logs', can('leads', 'edit'), async (req: Request, res: Response) => {
  const input = body(req, logSchema);
  const lead = await prisma.lead.findFirst({ where: { id: input.leadId, ...scope(req) } });
  if (!lead) throw AppError.notFound('Lead not found');
  const row = await prisma.$transaction(async (tx) => {
    const a = await tx.leadActivity.create({ data: { leadId: lead.id, type: input.type, connected: CONNECTED.includes(input.outcome), outcome: input.outcome, durationSeconds: input.durationSeconds, notes: input.notes, actorId: uid(req) } });
    if (lead.status === 'NEW' || lead.status === 'NOT_CONTACTED') await tx.lead.update({ where: { id: lead.id }, data: { status: 'CONTACTED' } });
    await audit({ action: 'lead.activity_logged', entityType: 'lead', entityId: lead.id, module: 'leads', actorType: 'EMPLOYEE', metadata: { type: input.type, outcome: input.outcome }, req }, tx);
    return a;
  });
  created(res, 'Activity logged', { activity: row });
});

crmRouter.get('/call-logs', can('leads', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req);
  const where: Prisma.LeadActivityWhereInput = { type: { in: ['CALL', 'MEETING'] }, ...(isAll(req) ? {} : { actorId: uid(req) }), ...(dateRange(q) ? { createdAt: dateRange(q) } : {}) };
  const [total, items] = await Promise.all([prisma.leadActivity.count({ where }), prisma.leadActivity.findMany({ where, orderBy: { createdAt: 'desc' }, ...win(q, true), include: { lead: { select: { id: true, leadCode: true, name: true, phone: true } } } })]);
  ok(res, 'Call logs', { total, page: q.page, pageSize: q.pageSize, items });
});

// ---- Follow-ups ----------------------------------------------------------------------------------

const followScope = (req: Request): Prisma.FollowUpWhereInput => ({ lead: { deletedAt: null }, ...(isAll(req) ? {} : { employeeId: empId(req) }) });

crmRouter.get('/follow-ups', can('leads', 'view'), async (req: Request, res: Response) => {
  const q = parseList(req, { tab: z.string().optional() });
  const today = istStart(todayIstStr());
  const tomorrow = new Date(today.getTime() + 86400_000);
  const TABS: Record<string, Prisma.FollowUpWhereInput> = { today: { status: 'PENDING', dueAt: { gte: today, lt: tomorrow } }, overdue: { status: 'PENDING', dueAt: { lt: today } }, upcoming: { status: 'PENDING', dueAt: { gte: tomorrow } }, completed: { status: 'DONE' } };
  const base = followScope(req);
  const where = { ...base, ...(TABS[String(q.tab)] ?? {}) };
  const [total, items, ...counts] = await Promise.all([
    prisma.followUp.count({ where }),
    prisma.followUp.findMany({ where, orderBy: { dueAt: q.tab === 'completed' ? 'desc' : 'asc' }, ...win(q, true), include: { lead: { select: { id: true, leadCode: true, name: true, contactPerson: true, phone: true } }, employee: { select: { user: { select: { fullName: true } } } } } }),
    ...Object.values(TABS).map((w) => prisma.followUp.count({ where: { ...base, ...w } })),
  ]);
  ok(res, 'Follow-ups', { total, page: q.page, pageSize: q.pageSize, items, counts: Object.fromEntries(Object.keys(TABS).map((k, i) => [k, counts[i]])) });
});

crmRouter.post('/follow-ups', can('leads', 'edit'), async (req: Request, res: Response) => {
  const input = body(req, z.object({ leadId: z.string().uuid(), dueAt: z.coerce.date(), followUpType: z.enum(FOLLOW_TYPES).default('PHONE_CALL'), notes: z.string().trim().max(1000).optional() }).strict());
  if (input.dueAt.getTime() < Date.now() - 60_000) throw AppError.badRequest('Choose a future date and time');
  const lead = await prisma.lead.findFirst({ where: { id: input.leadId, ...scope(req) } });
  if (!lead) throw AppError.notFound('Lead not found');
  const f = await prisma.$transaction(async (tx) => {
    const row = await tx.followUp.create({ data: { ...input, employeeId: lead.assignedEmployeeId ?? empId(req) } });
    await tx.lead.update({ where: { id: lead.id }, data: { nextFollowUpAt: input.dueAt, ...(['NEW', 'CONTACTED', 'NOT_CONTACTED'].includes(lead.status) ? { status: 'FOLLOW_UP' } : {}) } });
    await tx.leadActivity.create({ data: { leadId: lead.id, type: 'FOLLOW_UP', notes: input.notes, actorId: uid(req) } });
    return row;
  });
  created(res, 'Follow-up scheduled', { followUp: f });
});

async function followOr404(req: Request) {
  const f = await prisma.followUp.findFirst({ where: { id: idOf(req), ...followScope(req) } });
  if (!f) throw AppError.notFound('Follow-up not found');
  return f;
}

crmRouter.post('/follow-ups/:id/complete', can('leads', 'edit'), async (req: Request, res: Response) => {
  const f = await followOr404(req);
  if (f.status !== 'PENDING') throw AppError.conflict('This follow-up is already closed');
  const input = body(req, z.object({ callOutcome: z.enum(OUTCOMES), remarks: z.string().trim().max(300).optional(), nextDueAt: z.coerce.date().optional() }).strict());
  await prisma.$transaction(async (tx) => {
    await tx.followUp.update({ where: { id: f.id }, data: { status: 'DONE', callOutcome: input.callOutcome, outcome: input.remarks, completedAt: new Date() } });
    await tx.leadActivity.create({ data: { leadId: f.leadId, type: f.followUpType === 'PHONE_CALL' ? 'CALL' : f.followUpType === 'PHYSICAL_VISIT' || f.followUpType === 'ONLINE_MEETING' ? 'MEETING' : 'NOTE', connected: CONNECTED.includes(input.callOutcome), outcome: input.callOutcome, notes: input.remarks, actorId: uid(req) } });
    if (input.nextDueAt) await tx.followUp.create({ data: { leadId: f.leadId, employeeId: f.employeeId, dueAt: input.nextDueAt, followUpType: f.followUpType, notes: 'Next follow-up' } });
    await tx.lead.update({ where: { id: f.leadId }, data: { nextFollowUpAt: input.nextDueAt ?? null } });
    await audit({ action: 'followup.completed', entityType: 'follow_up', entityId: f.id, module: 'leads', actorType: 'EMPLOYEE', metadata: { outcome: input.callOutcome }, req }, tx);
  });
  ok(res, 'Follow-up completed', null);
});

crmRouter.post('/follow-ups/:id/reschedule', can('leads', 'edit'), async (req: Request, res: Response) => {
  const f = await followOr404(req);
  if (f.status !== 'PENDING') throw AppError.conflict('This follow-up is already closed');
  const { dueAt } = body(req, z.object({ dueAt: z.coerce.date() }).strict());
  if (dueAt.getTime() < Date.now() - 60_000) throw AppError.badRequest('Choose a future date and time');
  await prisma.$transaction([prisma.followUp.update({ where: { id: f.id }, data: { dueAt } }), prisma.lead.update({ where: { id: f.leadId }, data: { nextFollowUpAt: dueAt } })]);
  ok(res, 'Follow-up rescheduled', null);
});
