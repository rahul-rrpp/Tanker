/**
 * Admin Portal master data (idempotent): default employee roles with their permission matrices, KPI
 * definitions and default role targets, notification templates, compliance rules, commission rule,
 * subscription plans and the service catalogue. Existing rows are never overwritten so administrator
 * changes survive re-seeding.
 */
import type { PrismaClient } from '@prisma/client';
import { DEFAULT_EMPLOYEE_ROLES, DEFAULT_KPI_TARGETS, KPI_DEFINITIONS, adminPermissionKey, type AdminModule } from '../src/config/admin-permissions';

const TEMPLATES: [string, string, string, 'IN_APP' | 'EMAIL' | 'SMS' | 'WHATSAPP', string, string][] = [
  ['REGISTRATION_IN_APP', 'Registration successful', 'REGISTRATION', 'IN_APP', 'Welcome to TankerLink', 'Your company ID is {{companyCode}}. Upload your GST certificate and PAN to complete verification.'],
  ['VERIFICATION_EMAIL', 'Verification update', 'VERIFICATION', 'EMAIL', 'Your TankerLink verification status', 'Hello {{name}}, your account verification status is now {{status}}. {{reason}}'],
  ['BOOKING_CREATED_SMS', 'Booking created', 'BOOKING_CREATED', 'SMS', '', 'TankerLink: booking {{bookingCode}} created. We are finding tankers for you.'],
  ['OFFER_RECEIVED_WA', 'Offer received', 'OFFER_RECEIVED', 'WHATSAPP', '', 'New offer of Rs {{amount}} from {{transporter}} on {{bookingCode}}.'],
  ['OFFER_ACCEPTED_IN_APP', 'Offer accepted', 'OFFER_ACCEPTED', 'IN_APP', 'Offer accepted', '{{transporter}} confirmed for {{bookingCode}} at Rs {{amount}}.'],
  ['TRIP_STARTED_SMS', 'Trip started', 'TRIP_STARTED', 'SMS', '', 'TankerLink: tanker {{vehicle}} has started the trip for {{bookingCode}}.'],
  ['DELIVERY_EMAIL', 'Delivery completed', 'DELIVERY_COMPLETED', 'EMAIL', 'Delivery completed for {{bookingCode}}', 'Your load for {{bookingCode}} was delivered. Proof of delivery is available in Documents.'],
  ['PAYMENT_RECEIVED_EMAIL', 'Payment received', 'PAYMENT_RECEIVED', 'EMAIL', 'Payment received - {{receiptNumber}}', 'We received Rs {{amount}} for {{bookingCode}}. Receipt {{receiptNumber}}.'],
  ['DOCUMENT_EXPIRY_EMAIL', 'Document expiry reminder', 'DOCUMENT_EXPIRY', 'EMAIL', 'Document expiring on {{expiryDate}}', '{{documentType}} for {{owner}} expires on {{expiryDate}}. Please upload a renewed copy.'],
  ['COMPLAINT_CREATED_IN_APP', 'Complaint created', 'COMPLAINT_CREATED', 'IN_APP', 'Complaint {{ticketNumber}} registered', 'We have registered your complaint {{ticketNumber}} and will update you here.'],
];

const COMPLIANCE: [string, string, boolean, string, string | null][] = [
  ['COMPANY', 'GST_CERTIFICATE', false, 'GST registration certificate', null],
  ['COMPANY', 'PAN_CARD', false, 'Company PAN', null],
  ['TRANSPORTER', 'BUSINESS_KYC', false, 'Business KYC (incorporation / partnership deed)', null],
  ['TRANSPORTER', 'GST_CERTIFICATE', false, 'GST registration certificate', null],
  ['TRANSPORTER', 'BANK_DETAILS', false, 'Cancelled cheque / bank letter for settlements', null],
  ['DRIVER', 'DRIVING_LICENCE', true, 'Heavy goods vehicle licence', null],
  ['DRIVER', 'IDENTITY_PROOF', false, 'Aadhaar / voter ID', null],
  ['DRIVER', 'HAZARDOUS_TRAINING', true, 'Hazardous goods training / endorsement for Class A/B petroleum', 'PETROL'],
  ['TANKER', 'RC', false, 'Registration certificate', null],
  ['TANKER', 'INSURANCE', true, 'Vehicle insurance', null],
  ['TANKER', 'FITNESS', true, 'Fitness certificate', null],
  ['TANKER', 'PUC', true, 'Pollution under control certificate', null],
  ['TANKER', 'PERMIT', true, 'National / state goods permit', null],
  ['TANKER', 'PESO_LICENCE', true, 'PESO licence under Petroleum Rules (Class A petroleum)', 'PETROL'],
  ['TANKER', 'PESO_LICENCE', true, 'PESO licence under Petroleum Rules (Class B petroleum)', 'DIESEL'],
];

const SERVICES: [string, string, number, number, number, boolean][] = [
  ['GPS tracking device (AIS-140)', 'GPS_TRACKING_DEVICES', 7500, 5600, 18, false],
  ['GPS subscription - 12 months', 'GPS_SUBSCRIPTIONS', 2400, 1500, 18, false],
  ['Vehicle insurance facilitation', 'VEHICLE_INSURANCE', 1500, 0, 18, true],
  ['Driver recruitment', 'DRIVER_RECRUITMENT', 5000, 2000, 18, false],
  ['Hazardous goods driver training', 'DRIVER_TRAINING', 3500, 2200, 18, false],
  ['Premium listing - 30 days', 'PREMIUM_LISTING', 2999, 0, 18, false],
  ['Fleet management software - annual', 'FLEET_SOFTWARE', 12000, 6000, 18, false],
  ['Logistics consultancy (per day)', 'LOGISTICS_CONSULTANCY', 15000, 9000, 18, false],
];

export async function seedAdminData(prisma: PrismaClient) {
  const perms = new Map((await prisma.permission.findMany({ where: { key: { startsWith: 'adm.' } } })).map((p) => [p.key, p.id]));
  for (const r of DEFAULT_EMPLOYEE_ROLES) {
    const existing = await prisma.employeeRole.findUnique({ where: { code: r.code } });
    if (existing) continue;
    const role = await prisma.employeeRole.create({ data: { code: r.code, name: r.name, description: r.description, dataScope: r.dataScope, isSystem: true } });
    const ids = (Object.entries(r.grants) as [AdminModule, string[]][]).flatMap(([m, acts]) => acts.map((a) => perms.get(adminPermissionKey(m, a as never))!)).filter(Boolean);
    await prisma.employeeRolePermission.createMany({ data: ids.map((permissionId) => ({ roleId: role.id, permissionId })), skipDuplicates: true });
  }
  for (const k of KPI_DEFINITIONS) {
    await prisma.kpiDefinition.upsert({
      where: { code: k.code },
      update: {},
      create: { code: k.code, name: k.name, category: k.category, unit: 'unit' in k ? k.unit : 'count', higherIsBetter: 'higherIsBetter' in k ? k.higherIsBetter : true },
    });
  }
  const roles = new Map((await prisma.employeeRole.findMany()).map((r) => [r.code, r.id]));
  for (const [roleCode, targets] of Object.entries(DEFAULT_KPI_TARGETS)) {
    const roleId = roles.get(roleCode);
    if (!roleId) continue;
    for (const [kpiCode, target, weightage] of targets) {
      const exists = await prisma.kpiTarget.findFirst({ where: { kpiCode, roleId, employeeId: null } });
      if (!exists) await prisma.kpiTarget.create({ data: { kpiCode, roleId, monthlyTarget: target, weightage } });
    }
  }
  for (const [code, name, event, channel, subject, body] of TEMPLATES) {
    await prisma.notificationTemplate.upsert({ where: { code }, update: {}, create: { code, name, event, channel, subject: subject || null, body } });
  }
  if ((await prisma.complianceRule.count()) === 0) {
    const products = new Map((await prisma.product.findMany()).map((p) => [p.code, p.id]));
    for (const [ownerType, docType, requiresExpiry, description, product] of COMPLIANCE) {
      await prisma.complianceRule.create({ data: { ownerType, docType, requiresExpiry, description, productId: product ? (products.get(product) ?? null) : null } });
    }
  }
  if ((await prisma.commissionRule.count()) === 0) {
    await prisma.commissionRule.create({ data: { ruleCode: 'CR-STD', name: 'Standard platform commission', calcType: 'PERCENT', value: 5, effectiveFrom: new Date('2026-01-01T00:00:00Z') } });
  }
  if ((await prisma.subscriptionPlan.count()) === 0) {
    const plans: [string, string, string, number, number, string[], number | null, number][] = [
      ['COMPANY_FREE', 'Free', 'COMPANY', 0, 365, ['Unlimited booking requests', 'Standard support'], null, 0],
      ['COMPANY_SILVER', 'Silver', 'COMPANY', 4999, 30, ['Dedicated account manager', 'Priority support', 'Monthly MIS report'], null, 1],
      ['COMPANY_GOLD', 'Gold', 'COMPANY', 11999, 90, ['Everything in Silver', 'Quarterly business review'], null, 2],
      ['TRANSPORTER_FREE', 'Free', 'TRANSPORTER', 0, 365, ['Receive booking requests', 'Standard support'], 20, 0],
      ['TRANSPORTER_ENTERPRISE', 'Enterprise', 'TRANSPORTER', 24999, 365, ['Premium listing', 'Priority support', 'Fleet analytics'], null, 3],
    ];
    for (const [code, name, userCategory, price, validityDays, features, bookingLimit, priorityLevel] of plans) {
      await prisma.subscriptionPlan.create({ data: { code, name, userCategory, price, validityDays, features, bookingLimit, priorityLevel } });
    }
  }
  // Default leave entitlement. Starting values only: change them at /admin/hr/leave-policies to match your policy and applicable law.
  for (const [code, name, daysPerYear] of [['CASUAL', 'Casual Leave', 8], ['EARNED', 'Earned / Privilege Leave', 15], ['SICK', 'Sick Leave', 8], ['OTHER', 'Other Approved Leave', 0]] as const) {
    await prisma.leavePolicy.upsert({ where: { code }, update: {}, create: { code, name, daysPerYear } });
  }
  // Transporter tiers added with the Transporter Portal. Created only if absent; admin edits are preserved.
  for (const [code, name, price, validityDays, features, priorityLevel] of [
    ['TRANSPORTER_SILVER', 'Silver', 2999, 30, ['Earlier booking alerts', 'Priority support'], 1],
    ['TRANSPORTER_GOLD', 'Gold', 7999, 90, ['Everything in Silver', 'Featured in company offer lists', 'Fleet analytics'], 2],
  ] as [string, string, number, number, string[], number][]) {
    if (!(await prisma.subscriptionPlan.findUnique({ where: { code } }))) await prisma.subscriptionPlan.create({ data: { code, name, userCategory: 'TRANSPORTER', price, validityDays, features, bookingLimit: null, priorityLevel } });
  }
  if ((await prisma.service.count()) === 0) {
    let n = 0;
    for (const [name, category, sellingPrice, costPrice, taxRate, licensed] of SERVICES) {
      n++;
      await prisma.service.create({
        data: { serviceCode: `SRV${String(n).padStart(4, '0')}`, name, category, sellingPrice, costPrice, taxRate, requiresLicensedPartner: licensed, partnerName: licensed ? 'Licensed insurance partner (to be configured)' : null },
      });
    }
    await prisma.$executeRawUnsafe(`SELECT setval('service_code_seq', ${n})`);
  }
}
