import type { Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { storage } from '../../lib/storage';
import { storeUpload } from '../../middleware/upload';
import { validateRequest } from '../../middleware/validate';
import { AppError, ErrorCode } from '../../utils/errors';
import { audit } from '../audit/audit';

export const idParam = validateRequest({ params: z.object({ id: z.string().uuid('Invalid id') }) });
export const tid = (req: Request) => req.transporter!.id;
export const uid = (req: Request) => req.auth!.principal.userId;
export const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export const paging = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
export const pageOf = (q: { page: number; pageSize: number }) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });
export const parsePaging = (req: Request) => paging.parse({ page: req.query.page ?? 1, pageSize: req.query.pageSize ?? 25 });

/** Sets a current KYC document; a replaced one is kept (isCurrent=false) for audit. */
export async function saveKycDocument(
  req: Request,
  owner: { type: 'TRANSPORTER' | 'TANKER' | 'DRIVER'; id: string; transporterId: string },
  allowedTypes: readonly string[],
) {
  const input = z
    .object({
      docType: z.string().refine((d) => allowedTypes.includes(d), 'Choose a document type'),
      title: z.string().trim().max(120).optional(),
      expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional().or(z.literal('').transform(() => undefined)),
    })
    .strict()
    .parse(req.body ?? {});
  const file = await storeUpload(req.file, 'kyc-documents', ['pdf', 'png', 'jpeg']);
  try {
    return await prisma.$transaction(async (tx) => {
      // OTHER may have several current documents; each named type has exactly one.
      if (input.docType !== 'OTHER') await tx.kycDocument.updateMany({ where: { ownerType: owner.type, ownerId: owner.id, docType: input.docType, isCurrent: true }, data: { isCurrent: false } });
      const doc = await tx.kycDocument.create({
        data: { ownerType: owner.type, ownerId: owner.id, docType: input.docType, title: input.title, expiryDate: input.expiryDate ? new Date(`${input.expiryDate}T00:00:00Z`) : null, uploadedById: uid(req), ...file },
      });
      await audit({ action: 'kyc.document_uploaded', entityType: owner.type.toLowerCase(), entityId: owner.id, actorType: 'TRANSPORTER', actorUserId: uid(req), metadata: { docType: input.docType, documentId: doc.id }, req }, tx);
      return doc;
    });
  } catch (e) {
    await storage.remove(file.storageKey);
    throw e;
  }
}

export const publicDoc = { id: true, docType: true, title: true, fileName: true, mimeType: true, sizeBytes: true, status: true, reviewNote: true, expiryDate: true, createdAt: true } as const;

export function listKyc(ownerType: string, ownerId: string) {
  return prisma.kycDocument.findMany({ where: { ownerType, ownerId, isCurrent: true }, select: publicDoc, orderBy: { createdAt: 'desc' } });
}

/** A tanker owned by this transporter, or 404 (existence is never revealed). */
export async function ownedTanker(transporterId: string, id: string) {
  const t = await prisma.tanker.findFirst({ where: { id, transporterId } });
  if (!t) throw AppError.notFound('Tanker not found');
  return t;
}

export async function ownedDriver(transporterId: string, id: string) {
  const d = await prisma.driver.findFirst({ where: { id, agencyId: transporterId }, include: { user: { select: { id: true, fullName: true, phone: true, email: true, accountStatus: true, isPhoneVerified: true, lastLoginAt: true } } } });
  if (!d) throw AppError.notFound('Driver not found');
  return d;
}

export const notVerified = (what: string) => AppError.conflict(`${what} must be verified by TankerLink first`, ErrorCode.NOT_COMPLIANT);
