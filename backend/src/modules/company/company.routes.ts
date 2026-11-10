import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateUser } from '../../middleware/auth';
import { requireCompany } from '../../middleware/company';
import { multipart, sendStoredFile, storeUpload } from '../../middleware/upload';
import { validateRequest } from '../../middleware/validate';
import { prisma } from '../../lib/prisma';
import { storage } from '../../lib/storage';
import { AppError } from '../../utils/errors';
import { created, ok } from '../../utils/response';
import { phoneSchema } from '../../utils/validators';
import { audit } from '../audit/audit';
import * as company from './company.service';

export const idParam = validateRequest({ params: z.object({ id: z.string().uuid('Invalid id') }) });
export const ids = (req: Request) => ({ companyId: req.company!.id, userId: req.auth!.principal.userId });

// ---------------------------------------------------------------------------
// /companies
// ---------------------------------------------------------------------------

export const companiesRouter = Router();
companiesRouter.use(authenticateUser);

companiesRouter.get('/profile', requireCompany({ permission: 'company:profile:read' }), async (req: Request, res: Response) => {
  ok(res, 'Company profile', { company: await company.getProfile(req.company!.id) });
});

const saveProfile = [
  requireCompany({ permission: 'company:profile:manage' }),
  validateRequest({ body: company.updateProfileSchema }),
  async (req: Request, res: Response) => {
    const { companyId, userId } = ids(req);
    ok(res, 'Profile saved', { company: await company.updateProfile(companyId, userId, req.body, req) });
  },
];
companiesRouter.put('/profile', ...saveProfile);
companiesRouter.patch('/profile', ...saveProfile);

companiesRouter.post('/logo', requireCompany({ permission: 'company:profile:manage' }), multipart({ field: 'file' }), async (req: Request, res: Response) => {
  const { companyId, userId } = ids(req);
  const file = await storeUpload(req.file, 'company-logos', ['png', 'jpeg', 'webp']);
  await company.setLogo(companyId, userId, file, req);
  ok(res, 'Logo updated', { hasLogo: true });
});

companiesRouter.get('/logo', requireCompany(), async (req: Request, res: Response) => {
  sendStoredFile(res, await company.getLogo(req.company!.id), true);
});

companiesRouter.post(
  '/documents',
  requireCompany({ permission: 'company:profile:manage' }),
  multipart({ field: 'file' }),
  async (req: Request, res: Response) => {
    const meta = z
      .object({ type: z.enum(['GST_CERTIFICATE', 'PAN_CARD', 'REGISTRATION_CERTIFICATE', 'OTHER']), title: z.string().trim().max(120).optional() })
      .parse(req.body ?? {});
    if (meta.type === 'OTHER' && !meta.title) throw AppError.badRequest('Give this document a title', undefined, [{ field: 'title', message: 'Title is required for other documents' }]);
    const { companyId, userId } = ids(req);
    const file = await storeUpload(req.file, 'company-documents', ['pdf', 'png', 'jpeg']);
    const doc = await company.addDocument(companyId, userId, meta, file, req);
    created(res, 'Document uploaded', { document: doc });
  },
);

companiesRouter.get('/documents', requireCompany({ permission: 'company:profile:read' }), async (req: Request, res: Response) => {
  ok(res, 'Company documents', { documents: await company.listDocuments(req.company!.id, req.query.history === 'true') });
});

companiesRouter.get('/documents/:id/download', requireCompany({ permission: 'company:profile:read' }), idParam, async (req: Request, res: Response) => {
  const doc = await company.getDocumentFile(req.company!.id, String(req.params.id));
  sendStoredFile(res, doc, req.query.inline === '1');
});

companiesRouter.get('/dashboard', requireCompany({ permission: 'company:bookings:read' }), async (req: Request, res: Response) => {
  ok(res, 'Dashboard', await company.dashboard(req.company!.id, req.auth!.principal.userId));
});

// ---------------------------------------------------------------------------
// /locations (saved locations)
// ---------------------------------------------------------------------------

const locationSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required').max(120),
    type: z.enum(['FACTORY', 'OIL_DEPOT', 'WAREHOUSE', 'REFINERY', 'PETROL_PUMP', 'DELIVERY_POINT', 'OTHER']),
    contactPerson: z.string().trim().max(120).optional().transform((v) => v || undefined),
    contactPhone: phoneSchema.optional().or(z.literal('').transform(() => undefined)),
    address: z.string().trim().min(5, 'Address is required').max(400),
    placeId: z.string().trim().max(300).optional(),
    latitude: z.number().min(6).max(38, 'Location must be in India'),
    longitude: z.number().min(68).max(98, 'Location must be in India'),
    city: z.string().trim().max(80).optional(),
    state: z.string().trim().max(80).optional(),
    pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a valid PIN code').optional().or(z.literal('').transform(() => undefined)),
    isDefaultPickup: z.boolean().optional(),
    isDefaultDelivery: z.boolean().optional(),
  })
  .strict();

export const locationsRouter = Router();
locationsRouter.use(authenticateUser, requireCompany({ permission: 'company:locations:manage' }));

locationsRouter.get('/', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const type = typeof req.query.type === 'string' ? req.query.type : undefined;
  const locations = await prisma.savedLocation.findMany({
    where: {
      companyId: req.company!.id,
      ...(type ? { type: type as never } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { address: { contains: q, mode: 'insensitive' } }, { city: { contains: q, mode: 'insensitive' } }] } : {}),
    },
    orderBy: [{ isDefaultPickup: 'desc' }, { isDefaultDelivery: 'desc' }, { name: 'asc' }],
  });
  ok(res, 'Saved locations', { locations });
});

async function clearDefaults(companyId: string, body: { isDefaultPickup?: boolean; isDefaultDelivery?: boolean }, tx = prisma) {
  if (body.isDefaultPickup) await tx.savedLocation.updateMany({ where: { companyId, isDefaultPickup: true }, data: { isDefaultPickup: false } });
  if (body.isDefaultDelivery) await tx.savedLocation.updateMany({ where: { companyId, isDefaultDelivery: true }, data: { isDefaultDelivery: false } });
}

locationsRouter.post('/', validateRequest({ body: locationSchema }), async (req: Request, res: Response) => {
  const { companyId, userId } = ids(req);
  const count = await prisma.savedLocation.count({ where: { companyId } });
  if (count >= 200) throw AppError.badRequest('You can save up to 200 locations');
  const location = await prisma.$transaction(async (tx) => {
    await clearDefaults(companyId, req.body, tx as typeof prisma);
    return tx.savedLocation.create({ data: { ...req.body, companyId } });
  });
  await audit({ action: 'location.created', entityType: 'saved_location', entityId: location.id, companyId, actorUserId: userId, req });
  created(res, 'Location saved', { location });
});

locationsRouter.put('/:id', idParam, validateRequest({ body: locationSchema }), async (req: Request, res: Response) => {
  const { companyId, userId } = ids(req);
  const id = String(req.params.id);
  const location = await prisma.$transaction(async (tx) => {
    const existing = await tx.savedLocation.findFirst({ where: { id, companyId } });
    if (!existing) throw AppError.notFound('Location not found');
    await clearDefaults(companyId, req.body, tx as typeof prisma);
    return tx.savedLocation.update({ where: { id }, data: req.body });
  });
  await audit({ action: 'location.updated', entityType: 'saved_location', entityId: id, companyId, actorUserId: userId, req });
  ok(res, 'Location updated', { location });
});

locationsRouter.post(
  '/:id/default',
  idParam,
  validateRequest({ body: z.object({ kind: z.enum(['pickup', 'delivery']), value: z.boolean().default(true) }).strict() }),
  async (req: Request, res: Response) => {
    const { companyId } = ids(req);
    const id = String(req.params.id);
    const field = req.body.kind === 'pickup' ? 'isDefaultPickup' : 'isDefaultDelivery';
    const location = await prisma.$transaction(async (tx) => {
      const existing = await tx.savedLocation.findFirst({ where: { id, companyId } });
      if (!existing) throw AppError.notFound('Location not found');
      if (req.body.value) await tx.savedLocation.updateMany({ where: { companyId, [field]: true }, data: { [field]: false } });
      return tx.savedLocation.update({ where: { id }, data: { [field]: req.body.value } });
    });
    ok(res, 'Default updated', { location });
  },
);

locationsRouter.delete('/:id', idParam, async (req: Request, res: Response) => {
  const { companyId, userId } = ids(req);
  const id = String(req.params.id);
  const result = await prisma.savedLocation.deleteMany({ where: { id, companyId } });
  if (result.count === 0) throw AppError.notFound('Location not found');
  await audit({ action: 'location.deleted', entityType: 'saved_location', entityId: id, companyId, actorUserId: userId, req });
  ok(res, 'Location deleted', null);
});

// ---------------------------------------------------------------------------
// /companies/contacts (authorized contacts)
// ---------------------------------------------------------------------------

const contactSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required').max(120),
    designation: z.string().trim().max(80).optional().transform((v) => v || undefined),
    department: z.string().trim().max(80).optional().transform((v) => v || undefined),
    phone: phoneSchema,
    email: z.string().trim().toLowerCase().email('Enter a valid email').max(254).optional().or(z.literal('').transform(() => undefined)),
  })
  .strict();

companiesRouter.get('/contacts', requireCompany({ permission: 'company:profile:read' }), async (req: Request, res: Response) => {
  const contacts = await prisma.companyContact.findMany({ where: { companyId: req.company!.id }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] });
  ok(res, 'Contacts', { contacts });
});

companiesRouter.post('/contacts', requireCompany({ permission: 'company:profile:manage' }), validateRequest({ body: contactSchema }), async (req: Request, res: Response) => {
  const { companyId, userId } = ids(req);
  if ((await prisma.companyContact.count({ where: { companyId } })) >= 50) throw AppError.badRequest('You can add up to 50 contacts');
  const contact = await prisma.companyContact.create({ data: { ...req.body, companyId } });
  await audit({ action: 'company.contact_added', entityType: 'company_contact', entityId: contact.id, companyId, actorUserId: userId, req });
  created(res, 'Contact added', { contact });
});

companiesRouter.put('/contacts/:id', requireCompany({ permission: 'company:profile:manage' }), idParam, validateRequest({ body: contactSchema }), async (req: Request, res: Response) => {
  const { companyId, userId } = ids(req);
  const id = String(req.params.id);
  const r = await prisma.companyContact.updateMany({ where: { id, companyId }, data: req.body });
  if (r.count === 0) throw AppError.notFound('Contact not found');
  await audit({ action: 'company.contact_updated', entityType: 'company_contact', entityId: id, companyId, actorUserId: userId, req });
  ok(res, 'Contact updated', { contact: await prisma.companyContact.findUnique({ where: { id } }) });
});

companiesRouter.delete('/contacts/:id', requireCompany({ permission: 'company:profile:manage' }), idParam, async (req: Request, res: Response) => {
  const { companyId, userId } = ids(req);
  const id = String(req.params.id);
  const contact = await prisma.companyContact.findFirst({ where: { id, companyId } });
  if (!contact) throw AppError.notFound('Contact not found');
  if (contact.isPrimary) throw AppError.badRequest('The primary contact cannot be deleted. Edit it in Business information instead.');
  await prisma.companyContact.delete({ where: { id } });
  await audit({ action: 'company.contact_deleted', entityType: 'company_contact', entityId: id, companyId, actorUserId: userId, req });
  ok(res, 'Contact deleted', null);
});

/** Documents may be deleted only while not yet verified (verified KYC documents are locked for audit). */
companiesRouter.delete('/documents/:id', requireCompany({ permission: 'company:profile:manage' }), idParam, async (req: Request, res: Response) => {
  const { companyId, userId } = ids(req);
  const doc = await company.getDocumentFile(companyId, String(req.params.id));
  if (doc.status === 'VERIFIED') throw AppError.badRequest('Verified documents cannot be deleted. Upload a replacement instead.');
  await prisma.companyDocument.delete({ where: { id: doc.id } });
  await storage.remove(doc.storageKey).catch(() => undefined);
  await audit({ action: 'company.document_deleted', entityType: 'company_document', entityId: doc.id, companyId, actorUserId: userId, metadata: { type: doc.type, fileName: doc.fileName }, req });
  ok(res, 'Document deleted', null);
});
