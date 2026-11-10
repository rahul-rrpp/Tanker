import type { Prisma } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AdminModule } from '../../config/admin-permissions';
import { prisma } from '../../lib/prisma';
import { sendStoredFile } from '../../middleware/upload';
import { AppError, ErrorCode } from '../../utils/errors';
import { ok } from '../../utils/response';
import { assignedIds, assertInScope, body, can, hasPermission } from '../admin/core';
import { reviewHistory } from '../admin/parties.routes';
import { audit } from '../audit/audit';
import { notify, notifyDriver, notifyTransporter, notifyUser } from '../notifications/notification.service';
import { member, uid } from './common';

/**
 * Verification queue. An item id is "<KIND>:<uuid>". Approve and reject each need an explicit permission:
 * documents.approve/reject for files, and <entity>.approve/reject for the account or vehicle itself.
 */
const KINDS = ['COMPANY_DOC', 'KYC', 'BANK', 'COMPANY', 'TRANSPORTER', 'DRIVER', 'TANKER'] as const;
type Kind = (typeof KINDS)[number];
const MODULE: Record<Kind, AdminModule> = { COMPANY_DOC: 'documents', KYC: 'documents', BANK: 'documents', COMPANY: 'companies', TRANSPORTER: 'transporters', DRIVER: 'drivers', TANKER: 'tankers' };
const PENDING = ['PENDING_VERIFICATION', 'UNDER_REVIEW'] as const;

function parseId(req: Request): { kind: Kind; id: string } {
  const [kind, id] = String(req.params.id).split(':');
  if (!KINDS.includes(kind as Kind) || !z.string().uuid().safeParse(id).success) throw AppError.notFound('Not found');
  return { kind: kind as Kind, id };
}

/** The tenant an item belongs to, for ASSIGNED-scope checks. */
async function ownerOf(kind: Kind, id: string): Promise<{ type: 'COMPANY' | 'TRANSPORTER'; id: string }> {
  const nf = AppError.notFound('Item not found');
  switch (kind) {
    case 'COMPANY': return { type: 'COMPANY', id };
    case 'TRANSPORTER': return { type: 'TRANSPORTER', id };
    case 'COMPANY_DOC': { const d = await prisma.companyDocument.findUnique({ where: { id }, select: { companyId: true } }); if (!d) throw nf; return { type: 'COMPANY', id: d.companyId }; }
    case 'BANK': { const b = await prisma.transporterBankAccount.findUnique({ where: { id }, select: { transporterId: true } }); if (!b) throw nf; return { type: 'TRANSPORTER', id: b.transporterId }; }
    case 'DRIVER': { const d = await prisma.driver.findUnique({ where: { id }, select: { agencyId: true } }); if (!d) throw nf; return { type: 'TRANSPORTER', id: d.agencyId }; }
    case 'TANKER': { const t = await prisma.tanker.findUnique({ where: { id }, select: { transporterId: true } }); if (!t) throw nf; return { type: 'TRANSPORTER', id: t.transporterId }; }
    case 'KYC': {
      const d = await prisma.kycDocument.findUnique({ where: { id }, select: { ownerType: true, ownerId: true } });
      if (!d) throw nf;
      if (d.ownerType === 'TRANSPORTER') return { type: 'TRANSPORTER', id: d.ownerId };
      return ownerOf(d.ownerType === 'DRIVER' ? 'DRIVER' : 'TANKER', d.ownerId);
    }
  }
}

export const verificationRouter = Router();
verificationRouter.use(...member);

verificationRouter.get('/verifications', async (req: Request, res: Response) => {
  const see = (m: AdminModule) => hasPermission(req, m, 'view');
  if (!(['documents', 'companies', 'transporters', 'drivers', 'tankers'] as AdminModule[]).some(see)) throw AppError.forbidden();
  const [co, tr] = await Promise.all([assignedIds(req, 'COMPANY'), assignedIds(req, 'TRANSPORTER')]);
  const inCo = co ? { in: co } : undefined;
  const inTr = tr ? { in: tr } : undefined;
  const docs = see('documents');
  const [companyDocs, kyc, banks, companies, transporters, drivers, tankers] = await Promise.all([
    docs ? prisma.companyDocument.findMany({ where: { status: 'UPLOADED', isCurrent: true, companyId: inCo }, take: 200, orderBy: { createdAt: 'asc' }, include: { company: { select: { name: true } } } }) : [],
    docs ? prisma.kycDocument.findMany({ where: { status: 'UPLOADED', isCurrent: true }, take: 300, orderBy: { createdAt: 'asc' } }) : [],
    docs ? prisma.transporterBankAccount.findMany({ where: { status: 'PENDING_REVIEW', isCurrent: true, transporterId: inTr }, take: 100, select: { id: true, accountHolder: true, bankName: true, accountLast4: true, ifsc: true, createdAt: true, transporter: { select: { companyName: true } } } }) : [],
    see('companies') ? prisma.company.findMany({ where: { status: { in: [...PENDING] }, id: inCo }, take: 100, select: { id: true, name: true, status: true, createdAt: true } }) : [],
    see('transporters') ? prisma.agency.findMany({ where: { verificationStatus: { in: [...PENDING] }, id: inTr }, take: 100, select: { id: true, companyName: true, verificationStatus: true, createdAt: true } }) : [],
    see('drivers') ? prisma.driver.findMany({ where: { verificationStatus: { in: [...PENDING] }, agencyId: inTr }, take: 100, select: { id: true, verificationStatus: true, createdAt: true, licenceExpiry: true, user: { select: { fullName: true } }, agency: { select: { companyName: true } } } }) : [],
    see('tankers') ? prisma.tanker.findMany({ where: { verificationStatus: { in: [...PENDING] }, transporterId: inTr }, take: 100, select: { id: true, registrationNumber: true, verificationStatus: true, createdAt: true, transporter: { select: { companyName: true } } } }) : [],
  ]);
  // KYC rows are polymorphic: scope them after resolving the owner.
  const kycVisible = [];
  for (const d of kyc) {
    if (tr) {
      const o = await ownerOf('KYC', d.id);
      if (!tr.includes(o.id)) continue;
    }
    kycVisible.push({ id: `KYC:${d.id}`, category: d.ownerType, kind: 'DOCUMENT', title: d.docType, subject: d.fileName, status: d.status, createdAt: d.createdAt, hasFile: true });
  }
  const items = [
    ...companyDocs.map((d) => ({ id: `COMPANY_DOC:${d.id}`, category: 'COMPANY', kind: 'DOCUMENT', title: d.type, subject: d.company.name, status: d.status, createdAt: d.createdAt, hasFile: true })),
    ...kycVisible,
    ...banks.map((b) => ({ id: `BANK:${b.id}`, category: 'TRANSPORTER', kind: 'BANK', title: `Bank ${b.bankName} ••••${b.accountLast4} (${b.ifsc})`, subject: b.transporter.companyName, status: 'PENDING_REVIEW', createdAt: b.createdAt, hasFile: false })),
    ...companies.map((c) => ({ id: `COMPANY:${c.id}`, category: 'COMPANY', kind: 'ACCOUNT', title: 'Company KYC', subject: c.name, status: c.status as string, createdAt: c.createdAt, hasFile: false })),
    ...transporters.map((t) => ({ id: `TRANSPORTER:${t.id}`, category: 'TRANSPORTER', kind: 'ACCOUNT', title: 'Transporter KYC', subject: t.companyName, status: t.verificationStatus as string, createdAt: t.createdAt, hasFile: false })),
    ...drivers.map((d) => ({ id: `DRIVER:${d.id}`, category: 'DRIVER', kind: 'ACCOUNT', title: 'Driver verification', subject: `${d.user.fullName} (${d.agency.companyName})`, status: d.verificationStatus as string, createdAt: d.createdAt, hasFile: false })),
    ...tankers.map((t) => ({ id: `TANKER:${t.id}`, category: 'TANKER', kind: 'ACCOUNT', title: 'Tanker verification', subject: `${t.registrationNumber} (${t.transporter.companyName})`, status: t.verificationStatus as string, createdAt: t.createdAt, hasFile: false })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  ok(res, 'Verification queue', { items });
});

verificationRouter.get('/verifications/:id/file', can('documents', 'view'), async (req: Request, res: Response) => {
  const { kind, id } = parseId(req);
  const o = await ownerOf(kind, id);
  await assertInScope(req, o.type, o.id);
  const f = kind === 'COMPANY_DOC' ? await prisma.companyDocument.findUnique({ where: { id } }) : kind === 'KYC' ? await prisma.kycDocument.findUnique({ where: { id } }) : null;
  if (!f) throw AppError.notFound('No file for this item');
  sendStoredFile(res, f, req.query.inline === '1');
});

verificationRouter.get('/verifications/:id/history', async (req: Request, res: Response) => {
  const { kind, id } = parseId(req);
  if (!hasPermission(req, MODULE[kind], 'view')) throw AppError.forbidden();
  const o = await ownerOf(kind, id);
  await assertInScope(req, o.type, o.id);
  ok(res, 'History', { history: await reviewHistory(kind, id) });
});

const ENTITY_STATUS = { COMPANY: 'VERIFIED', TRANSPORTER: 'APPROVED', DRIVER: 'APPROVED', TANKER: 'APPROVED' } as const;

async function decide(req: Request, approve: boolean, input: { reason?: string; expiryDate?: Date; reupload?: boolean }) {
  const { kind, id } = parseId(req);
  if (!hasPermission(req, MODULE[kind], approve ? 'approve' : 'reject')) throw AppError.forbidden('You do not have verification permission for this item');
  const o = await ownerOf(kind, id);
  await assertInScope(req, o.type, o.id);
  if (!approve && (!input.reason || input.reason.length < 5)) throw AppError.badRequest('A rejection reason is required', ErrorCode.VALIDATION_ERROR, [{ field: 'reason', message: 'Explain why' }]);
  const reason = input.reupload ? `Re-upload requested: ${input.reason}` : input.reason;
  let from = '';
  const to = approve ? 'VERIFIED' : 'REJECTED';
  const finalTo: string = kind in ENTITY_STATUS ? (approve ? ENTITY_STATUS[kind as keyof typeof ENTITY_STATUS] : 'REJECTED') : to;
  let uploaderId: string | null = null;
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    switch (kind) {
      case 'COMPANY_DOC': {
        const d = await tx.companyDocument.findUniqueOrThrow({ where: { id } });
        if (d.status !== 'UPLOADED') throw AppError.conflict('Already reviewed');
        from = d.status; uploaderId = d.uploadedById;
        await tx.companyDocument.update({ where: { id }, data: { status: to, reviewNote: reason ?? null } });
        break;
      }
      case 'KYC': {
        const d = await tx.kycDocument.findUniqueOrThrow({ where: { id } });
        if (d.status !== 'UPLOADED') throw AppError.conflict('Already reviewed');
        if (approve && input.expiryDate && input.expiryDate.getTime() < Date.now()) throw AppError.conflict('This document has already expired');
        from = d.status; uploaderId = d.uploadedById;
        await tx.kycDocument.update({ where: { id }, data: { status: to, reviewNote: reason ?? null, ...(input.expiryDate ? { expiryDate: input.expiryDate } : {}) } });
        break;
      }
      case 'BANK': {
        const b = await tx.transporterBankAccount.findUniqueOrThrow({ where: { id } });
        if (b.status !== 'PENDING_REVIEW') throw AppError.conflict('Already reviewed');
        from = b.status;
        await tx.transporterBankAccount.update({ where: { id }, data: { status: to } });
        break;
      }
      case 'COMPANY': {
        const c = await tx.company.findUniqueOrThrow({ where: { id } });
        if (c.status === 'SUSPENDED') throw AppError.conflict('Reactivate this company first', ErrorCode.INVALID_STATE_TRANSITION);
        from = c.status;
        await tx.company.update({ where: { id }, data: { status: approve ? 'VERIFIED' : 'REJECTED', statusReason: approve ? null : reason, verifiedAt: approve ? new Date() : c.verifiedAt } });
        break;
      }
      case 'TRANSPORTER': {
        const t = await tx.agency.findUniqueOrThrow({ where: { id } });
        if (t.verificationStatus === 'SUSPENDED') throw AppError.conflict('Reactivate this transporter first', ErrorCode.INVALID_STATE_TRANSITION);
        from = t.verificationStatus;
        await tx.agency.update({ where: { id }, data: { verificationStatus: approve ? 'APPROVED' : 'REJECTED', rejectionReason: approve ? null : reason, verifiedAt: approve ? new Date() : t.verifiedAt, verifiedById: uid(req) } });
        break;
      }
      case 'DRIVER': {
        const d = await tx.driver.findUniqueOrThrow({ where: { id } });
        if (approve && d.licenceExpiry.getTime() < Date.now()) throw AppError.conflict('Driving licence has expired');
        from = d.verificationStatus;
        await tx.driver.update({ where: { id }, data: { verificationStatus: approve ? 'APPROVED' : 'REJECTED', rejectionReason: approve ? null : reason } });
        break;
      }
      case 'TANKER': {
        const t = await tx.tanker.findUniqueOrThrow({ where: { id } });
        if (approve && [t.insuranceExpiry, t.fitnessExpiry, t.permitExpiry].some((d) => d && d.getTime() < Date.now())) throw AppError.conflict('Cannot approve: a compliance document has expired');
        from = t.verificationStatus;
        await tx.tanker.update({ where: { id }, data: { verificationStatus: approve ? 'APPROVED' : 'REJECTED', rejectionReason: approve ? null : reason } });
        break;
      }
    }
    await tx.verificationReview.create({ data: { entityType: kind, entityId: id, fromStatus: from, toStatus: finalTo, reason: reason ?? null, reviewerId: uid(req) } });
    await audit({ action: `verification.${approve ? 'approved' : 'rejected'}`, entityType: kind.toLowerCase(), entityId: id, module: 'documents', actorType: 'EMPLOYEE', previousValue: { status: from }, newValue: { status: finalTo, reason: reason ?? null }, req }, tx);
  });
  const verb = approve ? 'approved' : 'rejected';
  const msg = approve ? 'Your verification item was approved.' : `Reason: ${reason}`;
  if (o.type === 'COMPANY') await notify({ companyId: o.id, type: 'COMPANY_VERIFICATION_UPDATE', title: `Verification ${verb}`, message: msg, link: '/company/profile' });
  else await notifyTransporter(o.id, { type: 'TRANSPORTER_VERIFICATION_UPDATE', title: `Verification ${verb}`, message: msg, link: '/transporter/profile' });
  if (kind === 'DRIVER') await notifyDriver(id, { type: 'TRANSPORTER_VERIFICATION_UPDATE', title: `Verification ${verb}`, message: msg, link: '/driver/profile' });
  if (!approve && uploaderId && uploaderId !== uid(req)) await notifyUser(uploaderId, { type: 'VERIFICATION_REJECTED', title: 'A document you uploaded was rejected', message: msg });
  return finalTo;
}

verificationRouter.post('/verifications/:id/approve', async (req: Request, res: Response) => {
  const input = body(req, z.object({ expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((s) => new Date(`${s}T00:00:00Z`)).optional() }).strict());
  ok(res, 'Approved', { status: await decide(req, true, input) });
});

verificationRouter.post('/verifications/:id/reject', async (req: Request, res: Response) => {
  const input = body(req, z.object({ reason: z.string().trim().min(5, 'Explain why').max(450), reupload: z.boolean().default(false) }).strict());
  ok(res, input.reupload ? 'Re-upload requested' : 'Rejected', { status: await decide(req, false, input) });
});
