-- Admin & back-office portal: employees, RBAC matrix, CRM, KPIs, commission, settlements,
-- subscriptions, services, KYC, trip operations, complaints workflow, templates, audit hardening.
-- Additive only: no existing data is dropped or rewritten.

-- CreateEnum
CREATE TYPE "HazardousTraining" AS ENUM ('NOT_PROVIDED', 'PENDING', 'VALID', 'EXPIRED', 'NOT_REQUIRED');

-- CreateEnum
CREATE TYPE "DataScope" AS ENUM ('ALL', 'ASSIGNED');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED');

-- AlterEnum
ALTER TYPE "VerificationStatus" ADD VALUE 'UNDER_REVIEW';

-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'ADMIN_2FA';

-- AlterEnum
ALTER TYPE "CompanyStatus" ADD VALUE 'UNDER_REVIEW';

-- AlterEnum
ALTER TYPE "ActorType" ADD VALUE 'EMPLOYEE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TankerStatus" ADD VALUE 'BOOKED';
ALTER TYPE "TankerStatus" ADD VALUE 'LOADING';
ALTER TYPE "TankerStatus" ADD VALUE 'IN_TRANSIT';
ALTER TYPE "TankerStatus" ADD VALUE 'UNLOADING';
ALTER TYPE "TankerStatus" ADD VALUE 'UNAVAILABLE';
ALTER TYPE "TankerStatus" ADD VALUE 'SUSPENDED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TripStatus" ADD VALUE 'REACHED_PICKUP';
ALTER TYPE "TripStatus" ADD VALUE 'LOADING_COMPLETED';
ALTER TYPE "TripStatus" ADD VALUE 'REACHED_DESTINATION';
ALTER TYPE "TripStatus" ADD VALUE 'UNLOADING_STARTED';
ALTER TYPE "TripStatus" ADD VALUE 'UNLOADING_COMPLETED';
ALTER TYPE "TripStatus" ADD VALUE 'DISPUTED';

-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'OFFLINE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'DOCUMENT_EXPIRY';
ALTER TYPE "NotificationType" ADD VALUE 'COMPLAINT_CREATED';
ALTER TYPE "NotificationType" ADD VALUE 'ADMIN_ALERT';
ALTER TYPE "NotificationType" ADD VALUE 'BROADCAST';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TicketStatus" ADD VALUE 'ASSIGNED';
ALTER TYPE "TicketStatus" ADD VALUE 'UNDER_INVESTIGATION';
ALTER TYPE "TicketStatus" ADD VALUE 'AWAITING_RESPONSE';

-- AlterTable
ALTER TABLE "Agency" ADD COLUMN     "category" VARCHAR(40),
ADD COLUMN     "createdById" UUID,
ADD COLUMN     "statusBeforeSuspension" "VerificationStatus",
ADD COLUMN     "suspensionReason" VARCHAR(500);

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "hazardousTraining" "HazardousTraining" NOT NULL DEFAULT 'NOT_PROVIDED',
ADD COLUMN     "hazardousTrainingExpiry" DATE,
ADD COLUMN     "rejectionReason" VARCHAR(500);

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "createdById" UUID,
ADD COLUMN     "statusBeforeSuspension" "CompanyStatus",
ADD COLUMN     "suspensionReason" VARCHAR(500);

-- AlterTable
ALTER TABLE "tankers" ADD COLUMN     "assignedDriverId" UUID,
ADD COLUMN     "currentLatitude" DECIMAL(9,6),
ADD COLUMN     "currentLongitude" DECIMAL(9,6),
ADD COLUMN     "fitnessExpiry" DATE,
ADD COLUMN     "insuranceExpiry" DATE,
ADD COLUMN     "lastLocationAt" TIMESTAMP(3),
ADD COLUMN     "permitExpiry" DATE,
ADD COLUMN     "pesoExpiry" DATE,
ADD COLUMN     "pesoLicenceNumber" VARCHAR(40),
ADD COLUMN     "pucExpiry" DATE,
ADD COLUMN     "rejectionReason" VARCHAR(500),
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "customerAuthorization" JSONB,
ADD COLUMN     "source" VARCHAR(20) NOT NULL DEFAULT 'PORTAL';

-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN     "assignedEmployeeId" UUID,
ADD COLUMN     "priority" VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "raisedByType" "ActorType" NOT NULL DEFAULT 'COMPANY';

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "actorRole" VARCHAR(40),
ADD COLUMN     "hash" CHAR(64),
ADD COLUMN     "module" VARCHAR(40),
ADD COLUMN     "newValue" JSONB,
ADD COLUMN     "prevHash" CHAR(64),
ADD COLUMN     "previousValue" JSONB,
ADD COLUMN     "sessionId" VARCHAR(64);

-- CreateTable
CREATE TABLE "employee_roles" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300),
    "dataScope" "DataScope" NOT NULL DEFAULT 'ASSIGNED',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "employee_role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "employeeCode" VARCHAR(12) NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "designation" VARCHAR(80) NOT NULL,
    "department" VARCHAR(80) NOT NULL,
    "reportingManagerId" UUID,
    "joiningDate" DATE NOT NULL,
    "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "loginEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_permission_overrides" (
    "employeeId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    "effect" VARCHAR(5) NOT NULL,

    CONSTRAINT "employee_permission_overrides_pkey" PRIMARY KEY ("employeeId","permissionId")
);

-- CreateTable
CREATE TABLE "employee_assignments" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "entityType" VARCHAR(20) NOT NULL,
    "entityId" UUID NOT NULL,
    "assignedById" UUID,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "employee_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_tasks" (
    "id" UUID NOT NULL,
    "taskCode" VARCHAR(14) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "assigneeId" UUID NOT NULL,
    "createdById" UUID,
    "dueAt" TIMESTAMP(3),
    "priority" VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
    "status" VARCHAR(15) NOT NULL DEFAULT 'OPEN',
    "relatedType" VARCHAR(20),
    "relatedId" UUID,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "leadCode" VARCHAR(14) NOT NULL,
    "leadType" VARCHAR(15) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "normalizedName" VARCHAR(160) NOT NULL,
    "contactPerson" VARCHAR(120),
    "phone" VARCHAR(15) NOT NULL,
    "email" VARCHAR(254),
    "gstNumber" VARCHAR(15),
    "city" VARCHAR(80),
    "state" VARCHAR(80),
    "source" VARCHAR(30) NOT NULL,
    "status" VARCHAR(25) NOT NULL DEFAULT 'NEW',
    "assignedEmployeeId" UUID,
    "nextFollowUpAt" TIMESTAMP(3),
    "remarks" VARCHAR(2000),
    "convertedEntityType" VARCHAR(20),
    "convertedEntityId" UUID,
    "convertedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "connected" BOOLEAN,
    "outcome" VARCHAR(120),
    "notes" VARCHAR(2000),
    "fromValue" VARCHAR(80),
    "toValue" VARCHAR(80),
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "employeeId" UUID,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "notes" VARCHAR(1000),
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "outcome" VARCHAR(300),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_definitions" (
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "unit" VARCHAR(20) NOT NULL DEFAULT 'count',
    "higherIsBetter" BOOLEAN NOT NULL DEFAULT true,
    "description" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_definitions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "kpi_targets" (
    "id" UUID NOT NULL,
    "kpiCode" VARCHAR(40) NOT NULL,
    "roleId" UUID,
    "employeeId" UUID,
    "monthlyTarget" DECIMAL(12,2) NOT NULL,
    "weightage" INTEGER NOT NULL DEFAULT 10,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpi_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_actuals" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "kpiCode" VARCHAR(40) NOT NULL,
    "periodStart" DATE NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_actuals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" UUID NOT NULL,
    "ruleCode" VARCHAR(20) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" VARCHAR(120) NOT NULL,
    "calcType" VARCHAR(10) NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "companyCategory" VARCHAR(40),
    "transporterCategory" VARCHAR(40),
    "originState" VARCHAR(80),
    "destState" VARCHAR(80),
    "bookingType" VARCHAR(20),
    "promoCode" VARCHAR(30),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "supersededAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_commissions" (
    "id" UUID NOT NULL,
    "allocationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "transporterId" UUID NOT NULL,
    "ruleId" UUID,
    "freightAmount" DECIMAL(12,2) NOT NULL,
    "commissionAmount" DECIMAL(12,2) NOT NULL,
    "transporterPayable" DECIMAL(12,2) NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" UUID NOT NULL,
    "settlementCode" VARCHAR(16) NOT NULL,
    "transporterId" UUID NOT NULL,
    "allocationId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "reference" VARCHAR(80),
    "settledAt" TIMESTAMP(3),
    "approvedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freight_adjustments" (
    "id" UUID NOT NULL,
    "allocationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "previousAmount" DECIMAL(12,2) NOT NULL,
    "newAmount" DECIMAL(12,2) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'REQUESTED',
    "requestedById" UUID NOT NULL,
    "reviewedById" UUID,
    "reviewNote" VARCHAR(500),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "freight_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_requests" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'REQUESTED',
    "requestedById" UUID NOT NULL,
    "approvedById" UUID,
    "reviewNote" VARCHAR(500),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_logs" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "result" VARCHAR(12) NOT NULL,
    "gatewayStatus" VARCHAR(30),
    "details" JSONB,
    "performedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "userCategory" VARCHAR(15) NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "validityDays" INTEGER NOT NULL,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bookingLimit" INTEGER,
    "priorityLevel" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "subscriptionCode" VARCHAR(16) NOT NULL,
    "planId" UUID NOT NULL,
    "subscriberType" VARCHAR(15) NOT NULL,
    "companyId" UUID,
    "transporterId" UUID,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "renewedFromId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "serviceCode" VARCHAR(14) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "description" VARCHAR(1000),
    "sellingPrice" DECIMAL(12,2) NOT NULL,
    "costPrice" DECIMAL(12,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "availability" VARCHAR(15) NOT NULL DEFAULT 'AVAILABLE',
    "requiresLicensedPartner" BOOLEAN NOT NULL DEFAULT false,
    "partnerName" VARCHAR(120),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_orders" (
    "id" UUID NOT NULL,
    "orderCode" VARCHAR(16) NOT NULL,
    "serviceId" UUID NOT NULL,
    "customerType" VARCHAR(15) NOT NULL,
    "companyId" UUID,
    "transporterId" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "costAmount" DECIMAL(12,2) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'REQUESTED',
    "assignedEmployeeId" UUID,
    "notes" VARCHAR(1000),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_documents" (
    "id" UUID NOT NULL,
    "ownerType" VARCHAR(15) NOT NULL,
    "ownerId" UUID NOT NULL,
    "docType" VARCHAR(40) NOT NULL,
    "title" VARCHAR(120),
    "fileName" VARCHAR(200) NOT NULL,
    "storageKey" VARCHAR(200) NOT NULL,
    "mimeType" VARCHAR(80) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "DocumentReviewStatus" NOT NULL DEFAULT 'UPLOADED',
    "reviewNote" VARCHAR(500),
    "expiryDate" DATE,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_rules" (
    "id" UUID NOT NULL,
    "ownerType" VARCHAR(15) NOT NULL,
    "docType" VARCHAR(40) NOT NULL,
    "productId" UUID,
    "tankerTypeId" UUID,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "requiresExpiry" BOOLEAN NOT NULL DEFAULT false,
    "description" VARCHAR(300),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_reviews" (
    "id" UUID NOT NULL,
    "entityType" VARCHAR(20) NOT NULL,
    "entityId" UUID NOT NULL,
    "fromStatus" VARCHAR(25),
    "toStatus" VARCHAR(25) NOT NULL,
    "reason" VARCHAR(500),
    "reviewerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_notes" (
    "id" UUID NOT NULL,
    "entityType" VARCHAR(20) NOT NULL,
    "entityId" UUID NOT NULL,
    "note" VARCHAR(2000) NOT NULL,
    "authorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_transporter_history" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "transporterId" UUID NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "toDate" TIMESTAMP(3),
    "reason" VARCHAR(300),

    CONSTRAINT "driver_transporter_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_status_history" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "fromStatus" "TripStatus",
    "toStatus" "TripStatus" NOT NULL,
    "isCorrection" BOOLEAN NOT NULL DEFAULT false,
    "reason" VARCHAR(500),
    "actorType" "ActorType" NOT NULL,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_alerts" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "type" VARCHAR(25) NOT NULL,
    "severity" VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
    "message" VARCHAR(300) NOT NULL,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,
    "resolutionNote" VARCHAR(500),

    CONSTRAINT "trip_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_activities" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "message" VARCHAR(2000),
    "internal" BOOLEAN NOT NULL DEFAULT true,
    "fromValue" VARCHAR(40),
    "toValue" VARCHAR(40),
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "event" VARCHAR(40) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "subject" VARCHAR(200),
    "body" VARCHAR(2000) NOT NULL,
    "providerTemplateId" VARCHAR(80),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_broadcasts" (
    "id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "audience" VARCHAR(30) NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "sentById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_roles_code_key" ON "employee_roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_employeeCode_key" ON "employees"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "employees_userId_key" ON "employees"("userId");

-- CreateIndex
CREATE INDEX "employees_roleId_idx" ON "employees"("roleId");

-- CreateIndex
CREATE INDEX "employee_assignments_entityType_entityId_endedAt_idx" ON "employee_assignments"("entityType", "entityId", "endedAt");

-- CreateIndex
CREATE INDEX "employee_assignments_employeeId_entityType_endedAt_idx" ON "employee_assignments"("employeeId", "entityType", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "employee_tasks_taskCode_key" ON "employee_tasks"("taskCode");

-- CreateIndex
CREATE INDEX "employee_tasks_assigneeId_status_idx" ON "employee_tasks"("assigneeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "leads_leadCode_key" ON "leads"("leadCode");

-- CreateIndex
CREATE INDEX "leads_assignedEmployeeId_status_idx" ON "leads"("assignedEmployeeId", "status");

-- CreateIndex
CREATE INDEX "leads_status_nextFollowUpAt_idx" ON "leads"("status", "nextFollowUpAt");

-- CreateIndex
CREATE UNIQUE INDEX "leads_leadType_phone_key" ON "leads"("leadType", "phone");

-- CreateIndex
CREATE INDEX "lead_activities_leadId_createdAt_idx" ON "lead_activities"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "lead_activities_actorId_type_createdAt_idx" ON "lead_activities"("actorId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "follow_ups_employeeId_status_dueAt_idx" ON "follow_ups"("employeeId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_targets_kpiCode_roleId_employeeId_key" ON "kpi_targets"("kpiCode", "roleId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_actuals_employeeId_kpiCode_periodStart_key" ON "kpi_actuals"("employeeId", "kpiCode", "periodStart");

-- CreateIndex
CREATE INDEX "commission_rules_isActive_effectiveFrom_idx" ON "commission_rules"("isActive", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "commission_rules_ruleCode_version_key" ON "commission_rules"("ruleCode", "version");

-- CreateIndex
CREATE UNIQUE INDEX "booking_commissions_allocationId_key" ON "booking_commissions"("allocationId");

-- CreateIndex
CREATE INDEX "booking_commissions_transporterId_computedAt_idx" ON "booking_commissions"("transporterId", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_settlementCode_key" ON "settlements"("settlementCode");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_allocationId_key" ON "settlements"("allocationId");

-- CreateIndex
CREATE INDEX "settlements_status_idx" ON "settlements"("status");

-- CreateIndex
CREATE INDEX "freight_adjustments_bookingId_idx" ON "freight_adjustments"("bookingId");

-- CreateIndex
CREATE INDEX "refund_requests_paymentId_idx" ON "refund_requests"("paymentId");

-- CreateIndex
CREATE INDEX "reconciliation_logs_paymentId_createdAt_idx" ON "reconciliation_logs"("paymentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_code_key" ON "subscription_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_subscriptionCode_key" ON "subscriptions"("subscriptionCode");

-- CreateIndex
CREATE INDEX "subscriptions_status_endAt_idx" ON "subscriptions"("status", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "services_serviceCode_key" ON "services"("serviceCode");

-- CreateIndex
CREATE UNIQUE INDEX "service_orders_orderCode_key" ON "service_orders"("orderCode");

-- CreateIndex
CREATE INDEX "service_orders_status_createdAt_idx" ON "service_orders"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_documents_storageKey_key" ON "kyc_documents"("storageKey");

-- CreateIndex
CREATE INDEX "kyc_documents_ownerType_ownerId_isCurrent_idx" ON "kyc_documents"("ownerType", "ownerId", "isCurrent");

-- CreateIndex
CREATE INDEX "kyc_documents_status_idx" ON "kyc_documents"("status");

-- CreateIndex
CREATE INDEX "kyc_documents_expiryDate_idx" ON "kyc_documents"("expiryDate");

-- CreateIndex
CREATE INDEX "compliance_rules_ownerType_isActive_idx" ON "compliance_rules"("ownerType", "isActive");

-- CreateIndex
CREATE INDEX "verification_reviews_entityType_entityId_createdAt_idx" ON "verification_reviews"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "verification_reviews_reviewerId_createdAt_idx" ON "verification_reviews"("reviewerId", "createdAt");

-- CreateIndex
CREATE INDEX "entity_notes_entityType_entityId_createdAt_idx" ON "entity_notes"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "driver_transporter_history_driverId_idx" ON "driver_transporter_history"("driverId");

-- CreateIndex
CREATE INDEX "trip_status_history_tripId_createdAt_idx" ON "trip_status_history"("tripId", "createdAt");

-- CreateIndex
CREATE INDEX "trip_alerts_tripId_type_resolvedAt_idx" ON "trip_alerts"("tripId", "type", "resolvedAt");

-- CreateIndex
CREATE INDEX "complaint_activities_ticketId_createdAt_idx" ON "complaint_activities"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_code_key" ON "notification_templates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tankers_assignedDriverId_key" ON "tankers"("assignedDriverId");

-- AddForeignKey
ALTER TABLE "tankers" ADD CONSTRAINT "tankers_assignedDriverId_fkey" FOREIGN KEY ("assignedDriverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_role_permissions" ADD CONSTRAINT "employee_role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "employee_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_role_permissions" ADD CONSTRAINT "employee_role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "employee_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_reportingManagerId_fkey" FOREIGN KEY ("reportingManagerId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_permission_overrides" ADD CONSTRAINT "employee_permission_overrides_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_permission_overrides" ADD CONSTRAINT "employee_permission_overrides_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_tasks" ADD CONSTRAINT "employee_tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_targets" ADD CONSTRAINT "kpi_targets_kpiCode_fkey" FOREIGN KEY ("kpiCode") REFERENCES "kpi_definitions"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_targets" ADD CONSTRAINT "kpi_targets_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "employee_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_targets" ADD CONSTRAINT "kpi_targets_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_actuals" ADD CONSTRAINT "kpi_actuals_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_actuals" ADD CONSTRAINT "kpi_actuals_kpiCode_fkey" FOREIGN KEY ("kpiCode") REFERENCES "kpi_definitions"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_commissions" ADD CONSTRAINT "booking_commissions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "commission_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_transporterId_fkey" FOREIGN KEY ("transporterId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_transporter_history" ADD CONSTRAINT "driver_transporter_history_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_transporter_history" ADD CONSTRAINT "driver_transporter_history_transporterId_fkey" FOREIGN KEY ("transporterId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_activities" ADD CONSTRAINT "complaint_activities_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Sequences for human-readable identifiers.
CREATE SEQUENCE IF NOT EXISTS employee_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS lead_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS task_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS settlement_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS subscription_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS service_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS service_order_code_seq START 1;

-- One active owner per company / transporter.
CREATE UNIQUE INDEX "employee_assignments_one_active" ON "employee_assignments" ("entityType", "entityId") WHERE "endedAt" IS NULL;

-- Money sanity.
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_value_non_negative" CHECK ("value" >= 0 AND ("calcType" <> 'PERCENT' OR "value" <= 100));
ALTER TABLE "booking_commissions" ADD CONSTRAINT "booking_commissions_amounts" CHECK ("commissionAmount" >= 0 AND "transporterPayable" >= 0);
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "freight_adjustments" ADD CONSTRAINT "freight_adjustments_amount_positive" CHECK ("newAmount" > 0);
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_price" CHECK ("price" >= 0 AND "validityDays" > 0);

-- Tamper resistance: audit rows can never be updated or deleted (rows are also hash-chained by the app).
CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

-- Financial history for the new ledgers is append-only as well.
CREATE TRIGGER settlements_no_delete BEFORE DELETE ON "settlements" FOR EACH ROW EXECUTE FUNCTION prevent_financial_delete();
CREATE TRIGGER booking_commissions_no_delete BEFORE DELETE ON "booking_commissions" FOR EACH ROW EXECUTE FUNCTION prevent_financial_delete();
CREATE TRIGGER refund_requests_no_delete BEFORE DELETE ON "refund_requests" FOR EACH ROW EXECUTE FUNCTION prevent_financial_delete();
CREATE TRIGGER freight_adjustments_no_delete BEFORE DELETE ON "freight_adjustments" FOR EACH ROW EXECUTE FUNCTION prevent_financial_delete();
