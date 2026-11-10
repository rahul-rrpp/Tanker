-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('MANUFACTURER', 'TRADER', 'DISTRIBUTOR', 'OIL_MARKETING_COMPANY', 'REFINERY', 'PETROL_PUMP_DEALER', 'INDUSTRIAL_CONSUMER', 'LOGISTICS_PROVIDER', 'OTHER');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('REGISTERED', 'BILLING');

-- CreateEnum
CREATE TYPE "CompanyDocumentType" AS ENUM ('GST_CERTIFICATE', 'PAN_CARD', 'REGISTRATION_CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentReviewStatus" AS ENUM ('UPLOADED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('FACTORY', 'OIL_DEPOT', 'WAREHOUSE', 'REFINERY', 'PETROL_PUMP', 'DELIVERY_POINT', 'OTHER');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('SEARCHING', 'OFFERS_RECEIVED', 'NEGOTIATION', 'CONFIRMED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'LOADING', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "BookingLocationType" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "ProductCompatibility" AS ENUM ('ANY_COMPATIBLE', 'DEDICATED', 'CLEANED_CERTIFIED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('COMPANY', 'TRANSPORTER', 'DRIVER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN', 'UNSUCCESSFUL');

-- CreateEnum
CREATE TYPE "NegotiationAction" AS ENUM ('OFFER_SUBMITTED', 'CUSTOMER_PRICE_ACCEPTED', 'COUNTER_OFFER', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TankerStatus" AS ENUM ('AVAILABLE', 'ON_TRIP', 'MAINTENANCE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('SCHEDULED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'LOADING', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TrackingSource" AS ENUM ('GPS_DEVICE', 'DRIVER_APP', 'SIMULATED');

-- CreateEnum
CREATE TYPE "TripDocumentType" AS ENUM ('DELIVERY_PROOF', 'LOADING_SLIP', 'LORRY_RECEIPT', 'E_WAY_BILL', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'ADVANCE_PAID', 'PARTIALLY_PAID', 'PAID', 'FAILED', 'REFUND_PENDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentTxnStatus" AS ENUM ('CREATED', 'PAID', 'FAILED', 'REFUND_PENDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('ADVANCE', 'BALANCE', 'FULL');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('UPI', 'NETBANKING', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('RAZORPAY', 'MOCK');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('REGISTRATION_SUCCESSFUL', 'COMPANY_VERIFICATION_UPDATE', 'BOOKING_CREATED', 'OFFER_RECEIVED', 'COUNTER_OFFER_RECEIVED', 'COUNTER_OFFER_ACCEPTED', 'OFFER_EXPIRED', 'BOOKING_CONFIRMED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'TRIP_STARTED', 'LOADING_COMPLETED', 'DELIVERY_COMPLETED', 'PAYMENT_RECEIVED', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'BOOKING_CANCELLED', 'SUPPORT_UPDATE');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'SMS', 'WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('TRANSPORTER_NOT_RESPONDING', 'VEHICLE_NOT_ASSIGNED', 'VEHICLE_DELAY', 'FREIGHT_DISAGREEMENT', 'DRIVER_ISSUE', 'LOADING_ISSUE', 'DELIVERY_ISSUE', 'PAYMENT_ISSUE', 'OTHER');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RoleName" ADD VALUE 'COMPANY_ADMIN';
ALTER TYPE "RoleName" ADD VALUE 'COMPANY_USER';
ALTER TYPE "RoleName" ADD VALUE 'EMPLOYEE';

-- AlterTable
ALTER TABLE "Agency" ADD COLUMN     "completedTrips" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rating" DECIMAL(2,1) NOT NULL DEFAULT 0,
ADD COLUMN     "serviceStates" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RefreshSession" ADD COLUMN     "persistent" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "companyCode" VARCHAR(12) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "gstNumber" VARCHAR(15) NOT NULL,
    "panNumber" VARCHAR(10),
    "businessType" "BusinessType" NOT NULL,
    "industry" VARCHAR(80),
    "website" VARCHAR(200),
    "logoKey" VARCHAR(200),
    "contactPersonName" VARCHAR(120) NOT NULL,
    "contactPhone" VARCHAR(15) NOT NULL,
    "contactEmail" VARCHAR(254) NOT NULL,
    "billingSameAsRegistered" BOOLEAN NOT NULL DEFAULT true,
    "status" "CompanyStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "statusReason" VARCHAR(500),
    "verifiedAt" TIMESTAMP(3),
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_users" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "RoleName" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_addresses" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "type" "AddressType" NOT NULL,
    "address" VARCHAR(300) NOT NULL,
    "city" VARCHAR(80) NOT NULL,
    "state" VARCHAR(80) NOT NULL,
    "pincode" CHAR(6) NOT NULL,
    "country" VARCHAR(60) NOT NULL DEFAULT 'India',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_contacts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "designation" VARCHAR(80),
    "phone" VARCHAR(15) NOT NULL,
    "email" VARCHAR(254),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_documents" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "type" "CompanyDocumentType" NOT NULL,
    "title" VARCHAR(120),
    "fileName" VARCHAR(200) NOT NULL,
    "storageKey" VARCHAR(200) NOT NULL,
    "mimeType" VARCHAR(80) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "DocumentReviewStatus" NOT NULL DEFAULT 'UPLOADED',
    "reviewNote" VARCHAR(500),
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_locations" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "LocationType" NOT NULL,
    "contactPerson" VARCHAR(120),
    "contactPhone" VARCHAR(15),
    "address" VARCHAR(400) NOT NULL,
    "placeId" VARCHAR(300),
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "city" VARCHAR(80),
    "state" VARCHAR(80),
    "pincode" VARCHAR(6),
    "isDefaultPickup" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultDelivery" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "description" VARCHAR(300),
    "requiresSpecialApproval" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tanker_types" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tanker_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "ratePerKm" DECIMAL(10,2) NOT NULL,
    "minimumFreight" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "capacityKl" DECIMAL(6,2),
    "productId" UUID,
    "tankerTypeId" UUID,
    "originState" VARCHAR(80),
    "destState" VARCHAR(80),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "description" VARCHAR(300),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "tankers" (
    "id" UUID NOT NULL,
    "transporterId" UUID NOT NULL,
    "registrationNumber" VARCHAR(15) NOT NULL,
    "capacityKl" DECIMAL(6,2) NOT NULL,
    "tankerTypeId" UUID NOT NULL,
    "compartments" INTEGER NOT NULL DEFAULT 1,
    "status" "TankerStatus" NOT NULL DEFAULT 'AVAILABLE',
    "gpsDeviceId" VARCHAR(60),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tankers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tanker_products" (
    "tankerId" UUID NOT NULL,
    "productId" UUID NOT NULL,

    CONSTRAINT "tanker_products_pkey" PRIMARY KEY ("tankerId","productId")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "bookingCode" VARCHAR(14) NOT NULL,
    "companyId" UUID NOT NULL,
    "createdById" UUID,
    "status" "BookingStatus" NOT NULL DEFAULT 'SEARCHING',
    "productId" UUID NOT NULL,
    "distanceKm" DECIMAL(10,2) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "routePolyline" TEXT,
    "routeSummary" VARCHAR(200),
    "routeProvider" VARCHAR(40) NOT NULL,
    "pricingRuleId" UUID,
    "ratePerKm" DECIMAL(10,2) NOT NULL,
    "suggestedFreight" DECIMAL(12,2) NOT NULL,
    "customerOffer" DECIMAL(12,2) NOT NULL,
    "acceptedFreight" DECIMAL(12,2),
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "loadingDate" DATE NOT NULL,
    "loadingTime" VARCHAR(5) NOT NULL,
    "loadingContactName" VARCHAR(120) NOT NULL,
    "loadingContactPhone" VARCHAR(15) NOT NULL,
    "loadingInstructions" VARCHAR(1000),
    "expectedDeliveryDate" DATE NOT NULL,
    "deliveryContactName" VARCHAR(120) NOT NULL,
    "deliveryContactPhone" VARCHAR(15) NOT NULL,
    "deliveryInstructions" VARCHAR(1000),
    "offerExpiryHours" INTEGER NOT NULL DEFAULT 24,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" VARCHAR(500),
    "repeatedFromId" UUID,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_locations" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "type" "BookingLocationType" NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "address" VARCHAR(400) NOT NULL,
    "placeId" VARCHAR(300),
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "city" VARCHAR(80),
    "state" VARCHAR(80),
    "pincode" VARCHAR(6),
    "savedLocationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_requirements" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "tankerCapacityKl" DECIMAL(6,2) NOT NULL,
    "quantityKl" DECIMAL(8,2) NOT NULL,
    "numberOfTankers" INTEGER NOT NULL,
    "tankerTypeId" UUID,
    "compartmentRequirement" VARCHAR(40),
    "productCompatibility" "ProductCompatibility" NOT NULL DEFAULT 'ANY_COMPATIBLE',
    "specialRequirements" VARCHAR(1000),

    CONSTRAINT "booking_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_status_history" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "fromStatus" "BookingStatus",
    "toStatus" "BookingStatus" NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorUserId" UUID,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transporter_offers" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "transporterId" UUID NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "initialAmount" DECIMAL(12,2) NOT NULL,
    "currentAmount" DECIMAL(12,2) NOT NULL,
    "lastActionBy" "ActorType" NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "tankersAvailable" INTEGER NOT NULL,
    "tankerCapacityKl" DECIMAL(6,2) NOT NULL,
    "estimatedAvailabilityAt" TIMESTAMP(3) NOT NULL,
    "remarks" VARCHAR(500),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "submittedById" UUID,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "transporter_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_negotiation_history" (
    "id" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "party" "ActorType" NOT NULL,
    "action" "NegotiationAction" NOT NULL,
    "amount" DECIMAL(12,2),
    "message" VARCHAR(500),
    "actorUserId" UUID,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_negotiation_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_allocations" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "transporterId" UUID NOT NULL,
    "tankersAllocated" INTEGER NOT NULL,
    "agreedFreight" DECIMAL(12,2) NOT NULL,
    "status" "AllocationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "tripCode" VARCHAR(14) NOT NULL,
    "allocationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "transporterId" UUID NOT NULL,
    "tankerId" UUID,
    "driverId" UUID,
    "status" "TripStatus" NOT NULL DEFAULT 'SCHEDULED',
    "plannedDistanceKm" DECIMAL(10,2) NOT NULL,
    "distanceTravelledKm" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lastLatitude" DECIMAL(9,6),
    "lastLongitude" DECIMAL(9,6),
    "lastGpsAt" TIMESTAMP(3),
    "etaAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "loadedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_tracking" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "speedKmph" DECIMAL(5,1),
    "heading" INTEGER,
    "source" "TrackingSource" NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_documents" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "type" "TripDocumentType" NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "fileName" VARCHAR(200) NOT NULL,
    "storageKey" VARCHAR(200) NOT NULL,
    "mimeType" VARCHAR(80) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sharedWithCompany" BOOLEAN NOT NULL DEFAULT true,
    "uploadedById" UUID,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "receiptNumber" VARCHAR(16),
    "bookingId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "status" "PaymentTxnStatus" NOT NULL DEFAULT 'CREATED',
    "provider" "PaymentProvider" NOT NULL,
    "providerOrderId" VARCHAR(60) NOT NULL,
    "providerPaymentId" VARCHAR(60),
    "method" "PaymentMethod",
    "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" VARCHAR(300),
    "gatewayPayload" JSONB,
    "paidAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "invoiceNumber" VARCHAR(16) NOT NULL,
    "bookingId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "freightAmount" DECIMAL(12,2) NOT NULL,
    "platformFee" DECIMAL(12,2) NOT NULL,
    "gstPercent" DECIMAL(5,2) NOT NULL,
    "gstAmount" DECIMAL(12,2) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "companyId" UUID,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "bookingId" UUID,
    "link" VARCHAR(200),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL,
    "providerRef" VARCHAR(120),
    "error" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "preferences" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "ticketNumber" VARCHAR(12) NOT NULL,
    "companyId" UUID NOT NULL,
    "bookingId" UUID,
    "category" "TicketCategory" NOT NULL,
    "subject" VARCHAR(160) NOT NULL,
    "description" VARCHAR(4000) NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionNote" VARCHAR(1000),
    "resolvedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_attachments" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "fileName" VARCHAR(200) NOT NULL,
    "storageKey" VARCHAR(200) NOT NULL,
    "mimeType" VARCHAR(80) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "actorType" "ActorType" NOT NULL,
    "companyId" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entityType" VARCHAR(40) NOT NULL,
    "entityId" UUID,
    "metadata" JSONB,
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_companyCode_key" ON "companies"("companyCode");

-- CreateIndex
CREATE UNIQUE INDEX "companies_gstNumber_key" ON "companies"("gstNumber");

-- CreateIndex
CREATE INDEX "companies_status_idx" ON "companies"("status");

-- CreateIndex
CREATE UNIQUE INDEX "company_users_userId_key" ON "company_users"("userId");

-- CreateIndex
CREATE INDEX "company_users_companyId_idx" ON "company_users"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "company_addresses_companyId_type_key" ON "company_addresses"("companyId", "type");

-- CreateIndex
CREATE INDEX "company_contacts_companyId_idx" ON "company_contacts"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "company_documents_storageKey_key" ON "company_documents"("storageKey");

-- CreateIndex
CREATE INDEX "company_documents_companyId_type_isCurrent_idx" ON "company_documents"("companyId", "type", "isCurrent");

-- CreateIndex
CREATE INDEX "saved_locations_companyId_name_idx" ON "saved_locations"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tanker_types_code_key" ON "tanker_types"("code");

-- CreateIndex
CREATE INDEX "pricing_rules_isActive_priority_idx" ON "pricing_rules"("isActive", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "tankers_registrationNumber_key" ON "tankers"("registrationNumber");

-- CreateIndex
CREATE INDEX "tankers_transporterId_status_idx" ON "tankers"("transporterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_bookingCode_key" ON "bookings"("bookingCode");

-- CreateIndex
CREATE INDEX "bookings_companyId_status_createdAt_idx" ON "bookings"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "bookings_companyId_createdAt_idx" ON "bookings"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "booking_locations_bookingId_type_sequence_key" ON "booking_locations"("bookingId", "type", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "booking_requirements_bookingId_key" ON "booking_requirements"("bookingId");

-- CreateIndex
CREATE INDEX "booking_status_history_bookingId_createdAt_idx" ON "booking_status_history"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "transporter_offers_bookingId_status_idx" ON "transporter_offers"("bookingId", "status");

-- CreateIndex
CREATE INDEX "transporter_offers_status_expiresAt_idx" ON "transporter_offers"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "transporter_offers_bookingId_transporterId_key" ON "transporter_offers"("bookingId", "transporterId");

-- CreateIndex
CREATE INDEX "offer_negotiation_history_offerId_createdAt_idx" ON "offer_negotiation_history"("offerId", "createdAt");

-- CreateIndex
CREATE INDEX "offer_negotiation_history_bookingId_createdAt_idx" ON "offer_negotiation_history"("bookingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "booking_allocations_offerId_key" ON "booking_allocations"("offerId");

-- CreateIndex
CREATE INDEX "booking_allocations_bookingId_idx" ON "booking_allocations"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "trips_tripCode_key" ON "trips"("tripCode");

-- CreateIndex
CREATE INDEX "trips_bookingId_idx" ON "trips"("bookingId");

-- CreateIndex
CREATE INDEX "trips_status_idx" ON "trips"("status");

-- CreateIndex
CREATE INDEX "trip_tracking_tripId_recordedAt_idx" ON "trip_tracking"("tripId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "trip_documents_storageKey_key" ON "trip_documents"("storageKey");

-- CreateIndex
CREATE INDEX "trip_documents_bookingId_idx" ON "trip_documents"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_receiptNumber_key" ON "payments"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerOrderId_key" ON "payments"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerPaymentId_key" ON "payments"("providerPaymentId");

-- CreateIndex
CREATE INDEX "payments_companyId_createdAt_idx" ON "payments"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_bookingId_idx" ON "payments"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "invoices_companyId_issuedAt_idx" ON "invoices"("companyId", "issuedAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_notificationId_idx" ON "notification_deliveries"("notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_key" ON "notification_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_ticketNumber_key" ON "support_tickets"("ticketNumber");

-- CreateIndex
CREATE INDEX "support_tickets_companyId_status_createdAt_idx" ON "support_tickets"("companyId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "support_attachments_storageKey_key" ON "support_attachments"("storageKey");

-- CreateIndex
CREATE INDEX "support_attachments_ticketId_idx" ON "support_attachments"("ticketId");

-- CreateIndex
CREATE INDEX "audit_logs_companyId_createdAt_idx" ON "audit_logs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "company_users" ADD CONSTRAINT "company_users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_users" ADD CONSTRAINT "company_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_addresses" ADD CONSTRAINT "company_addresses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_contacts" ADD CONSTRAINT "company_contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_locations" ADD CONSTRAINT "saved_locations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_tankerTypeId_fkey" FOREIGN KEY ("tankerTypeId") REFERENCES "tanker_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tankers" ADD CONSTRAINT "tankers_transporterId_fkey" FOREIGN KEY ("transporterId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tankers" ADD CONSTRAINT "tankers_tankerTypeId_fkey" FOREIGN KEY ("tankerTypeId") REFERENCES "tanker_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tanker_products" ADD CONSTRAINT "tanker_products_tankerId_fkey" FOREIGN KEY ("tankerId") REFERENCES "tankers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tanker_products" ADD CONSTRAINT "tanker_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_pricingRuleId_fkey" FOREIGN KEY ("pricingRuleId") REFERENCES "pricing_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_repeatedFromId_fkey" FOREIGN KEY ("repeatedFromId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_locations" ADD CONSTRAINT "booking_locations_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_locations" ADD CONSTRAINT "booking_locations_savedLocationId_fkey" FOREIGN KEY ("savedLocationId") REFERENCES "saved_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_requirements" ADD CONSTRAINT "booking_requirements_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_requirements" ADD CONSTRAINT "booking_requirements_tankerTypeId_fkey" FOREIGN KEY ("tankerTypeId") REFERENCES "tanker_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transporter_offers" ADD CONSTRAINT "transporter_offers_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transporter_offers" ADD CONSTRAINT "transporter_offers_transporterId_fkey" FOREIGN KEY ("transporterId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_negotiation_history" ADD CONSTRAINT "offer_negotiation_history_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "transporter_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_negotiation_history" ADD CONSTRAINT "offer_negotiation_history_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_allocations" ADD CONSTRAINT "booking_allocations_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_allocations" ADD CONSTRAINT "booking_allocations_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "transporter_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_allocations" ADD CONSTRAINT "booking_allocations_transporterId_fkey" FOREIGN KEY ("transporterId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "booking_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_transporterId_fkey" FOREIGN KEY ("transporterId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_tankerId_fkey" FOREIGN KEY ("tankerId") REFERENCES "tankers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_tracking" ADD CONSTRAINT "trip_tracking_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_documents" ADD CONSTRAINT "trip_documents_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_documents" ADD CONSTRAINT "trip_documents_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
