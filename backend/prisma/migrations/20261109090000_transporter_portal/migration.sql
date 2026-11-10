-- Transporter Portal. Strictly additive: no column or table is dropped and no data is rewritten.
-- The only relaxation is support_tickets."companyId" becoming nullable so transporters can raise tickets.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'BANK_CHANGE';
ALTER TYPE "TankerStatus" ADD VALUE IF NOT EXISTS 'RESERVED';
ALTER TYPE "TripStatus" ADD VALUE IF NOT EXISTS 'DRIVER_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'NEW_BOOKING_AVAILABLE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BOOKING_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'OFFER_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'OFFER_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRIP_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRIP_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SETTLEMENT_PROCESSED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRANSPORTER_VERIFICATION_UPDATE';
ALTER TYPE "TicketCategory" ADD VALUE IF NOT EXISTS 'BOOKING_ISSUE';
ALTER TYPE "TicketCategory" ADD VALUE IF NOT EXISTS 'FREIGHT_NEGOTIATION';
ALTER TYPE "TicketCategory" ADD VALUE IF NOT EXISTS 'COMPANY_DISPUTE';
ALTER TYPE "TicketCategory" ADD VALUE IF NOT EXISTS 'GPS_ISSUE';
ALTER TYPE "TicketCategory" ADD VALUE IF NOT EXISTS 'SETTLEMENT_ISSUE';
ALTER TYPE "TicketCategory" ADD VALUE IF NOT EXISTS 'DOCUMENT_VERIFICATION';
ALTER TYPE "TicketCategory" ADD VALUE IF NOT EXISTS 'TECHNICAL_SUPPORT';

-- Transporter ID, e.g. TRP000001. Existing transporters are numbered by the column default.
CREATE SEQUENCE IF NOT EXISTS transporter_code_seq;

ALTER TABLE "Agency"
  ADD COLUMN "transporterCode" VARCHAR(12) NOT NULL DEFAULT ('TRP'::text || lpad((nextval('transporter_code_seq'::regclass))::text, 6, '0'::text)),
  ADD COLUMN "businessType" VARCHAR(40),
  ADD COLUMN "operationalAddress" VARCHAR(300),
  ADD COLUMN "operatingCities" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "preferredRoutes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "declaredTankers" INTEGER,
  ADD COLUMN "capacityCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "productCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "bookingAlertPrefs" JSONB;
CREATE UNIQUE INDEX "Agency_transporterCode_key" ON "Agency"("transporterCode");

ALTER TABLE "Driver"
  ADD COLUMN "address" VARCHAR(300),
  ADD COLUMN "emergencyContactName" VARCHAR(120),
  ADD COLUMN "emergencyContactPhone" VARCHAR(15),
  ADD COLUMN "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "invitedAt" TIMESTAMP(3);

ALTER TABLE "tankers"
  ADD COLUMN "vehicleMake" VARCHAR(60),
  ADD COLUMN "vehicleModel" VARCHAR(60),
  ADD COLUMN "manufacturingYear" INTEGER,
  ADD COLUMN "availableFrom" TIMESTAMP(3),
  ADD COLUMN "availableLocation" VARCHAR(200),
  ADD COLUMN "availableLatitude" DECIMAL(9,6),
  ADD COLUMN "availableLongitude" DECIMAL(9,6);

ALTER TABLE "trips"
  ADD COLUMN "plannedStartAt" TIMESTAMP(3),
  ADD COLUMN "plannedEndAt" TIMESTAMP(3),
  ADD COLUMN "exception" VARCHAR(12),
  ADD COLUMN "driverAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "releasedAt" TIMESTAMP(3);

ALTER TABLE "trip_status_history"
  ADD COLUMN "latitude" DECIMAL(9,6),
  ADD COLUMN "longitude" DECIMAL(9,6);

ALTER TABLE "service_orders" ADD COLUMN "requestType" VARCHAR(10) NOT NULL DEFAULT 'ORDER';

ALTER TABLE "support_tickets"
  ALTER COLUMN "companyId" DROP NOT NULL,
  ADD COLUMN "transporterId" UUID;
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_transporterId_fkey"
  FOREIGN KEY ("transporterId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_has_tenant"
  CHECK ("companyId" IS NOT NULL OR "transporterId" IS NOT NULL);
CREATE INDEX "support_tickets_transporterId_status_createdAt_idx" ON "support_tickets"("transporterId", "status", "createdAt");

CREATE TABLE "transporter_contacts" (
  "id" UUID NOT NULL,
  "transporterId" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "designation" VARCHAR(80),
  "phone" VARCHAR(15) NOT NULL,
  "email" VARCHAR(254),
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "transporter_contacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transporter_contacts_transporterId_fkey" FOREIGN KEY ("transporterId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "transporter_contacts_transporterId_idx" ON "transporter_contacts"("transporterId");

CREATE TABLE "transporter_bank_accounts" (
  "id" UUID NOT NULL,
  "transporterId" UUID NOT NULL,
  "accountHolder" VARCHAR(120) NOT NULL,
  "bankName" VARCHAR(120) NOT NULL,
  "accountNumberEnc" VARCHAR(200) NOT NULL,
  "accountLast4" CHAR(4) NOT NULL,
  "ifsc" CHAR(11) NOT NULL,
  "accountType" VARCHAR(15) NOT NULL,
  "status" VARCHAR(15) NOT NULL DEFAULT 'PENDING_REVIEW',
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transporter_bank_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transporter_bank_accounts_transporterId_fkey" FOREIGN KEY ("transporterId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "transporter_bank_accounts_transporterId_isCurrent_idx" ON "transporter_bank_accounts"("transporterId", "isCurrent");
-- At most one current payout account per transporter.
CREATE UNIQUE INDEX "transporter_bank_accounts_one_current" ON "transporter_bank_accounts"("transporterId") WHERE "isCurrent";

CREATE TABLE "tanker_compartments" (
  "id" UUID NOT NULL,
  "tankerId" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "capacityKl" DECIMAL(6,2) NOT NULL,
  CONSTRAINT "tanker_compartments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tanker_compartments_tankerId_fkey" FOREIGN KEY ("tankerId") REFERENCES "tankers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "tanker_compartments_tankerId_position_key" ON "tanker_compartments"("tankerId", "position");

CREATE TABLE "tanker_availability" (
  "id" UUID NOT NULL,
  "tankerId" UUID NOT NULL,
  "kind" VARCHAR(12) NOT NULL,
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "note" VARCHAR(300),
  "createdById" UUID,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tanker_availability_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tanker_availability_tankerId_fkey" FOREIGN KEY ("tankerId") REFERENCES "tankers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tanker_availability_valid_range" CHECK ("endAt" > "startAt")
);
CREATE INDEX "tanker_availability_tankerId_startAt_idx" ON "tanker_availability"("tankerId", "startAt");

CREATE TABLE "booking_ignores" (
  "bookingId" UUID NOT NULL,
  "transporterId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_ignores_pkey" PRIMARY KEY ("bookingId", "transporterId"),
  CONSTRAINT "booking_ignores_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "booking_ignores_transporterId_fkey" FOREIGN KEY ("transporterId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- A tanker / driver cannot hold two overlapping live assignments, enforced by the database under any
-- concurrency. Windows are set when the transporter assigns resources; older rows (NULL windows) are exempt.
ALTER TABLE "trips" ADD CONSTRAINT "trips_valid_window" CHECK ("plannedStartAt" IS NULL OR "plannedEndAt" IS NULL OR "plannedEndAt" > "plannedStartAt");
ALTER TABLE "trips" ADD CONSTRAINT "trips_tanker_no_overlap" EXCLUDE USING gist (
  "tankerId" WITH =, tsrange("plannedStartAt", "plannedEndAt") WITH &&
) WHERE ("tankerId" IS NOT NULL AND "plannedStartAt" IS NOT NULL AND "plannedEndAt" IS NOT NULL AND "status" NOT IN ('COMPLETED', 'CANCELLED'));
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_no_overlap" EXCLUDE USING gist (
  "driverId" WITH =, tsrange("plannedStartAt", "plannedEndAt") WITH &&
) WHERE ("driverId" IS NOT NULL AND "plannedStartAt" IS NOT NULL AND "plannedEndAt" IS NOT NULL AND "status" NOT IN ('COMPLETED', 'CANCELLED'));
