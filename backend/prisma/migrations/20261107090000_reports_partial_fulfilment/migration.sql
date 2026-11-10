-- Card payments distinguish debit and credit cards.
ALTER TYPE "PaymentMethod" ADD VALUE 'DEBIT_CARD';
ALTER TYPE "PaymentMethod" ADD VALUE 'CREDIT_CARD';

-- New notification events.
ALTER TYPE "NotificationType" ADD VALUE 'OFFER_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE 'LOADING_STARTED';

-- Complaint categories revised (existing rows are mapped, nothing is lost).
CREATE TYPE "TicketCategory_new" AS ENUM ('TRANSPORTER_ISSUE', 'DRIVER_ISSUE', 'VEHICLE_DELAY', 'FREIGHT_DISPUTE', 'LOADING_PROBLEM', 'DELIVERY_PROBLEM', 'PAYMENT_PROBLEM', 'OTHER');
ALTER TABLE "support_tickets" ALTER COLUMN "category" TYPE "TicketCategory_new" USING (
  CASE "category"::text
    WHEN 'TRANSPORTER_NOT_RESPONDING' THEN 'TRANSPORTER_ISSUE'
    WHEN 'VEHICLE_NOT_ASSIGNED' THEN 'TRANSPORTER_ISSUE'
    WHEN 'FREIGHT_DISAGREEMENT' THEN 'FREIGHT_DISPUTE'
    WHEN 'LOADING_ISSUE' THEN 'LOADING_PROBLEM'
    WHEN 'DELIVERY_ISSUE' THEN 'DELIVERY_PROBLEM'
    WHEN 'PAYMENT_ISSUE' THEN 'PAYMENT_PROBLEM'
    ELSE "category"::text
  END
)::"TicketCategory_new";
ALTER TYPE "TicketCategory" RENAME TO "TicketCategory_old";
ALTER TYPE "TicketCategory_new" RENAME TO "TicketCategory";
DROP TYPE "TicketCategory_old";

-- Authorized contacts carry a department.
ALTER TABLE "company_contacts" ADD COLUMN "department" VARCHAR(80);

-- Pricing: flat additional charge per tanker.
ALTER TABLE "pricing_rules" ADD COLUMN "additionalCharge" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "additionalChargeLabel" VARCHAR(80);

-- Partial fulfilment: a multi-tanker booking may be allocated to several transporters, so the
-- "one accepted offer per booking" index is replaced by an application-level guard under the booking
-- row lock (sum of allocated tankers <= tankers required) plus one allocation per offer (unique offerId).
DROP INDEX IF EXISTS "transporter_offers_one_accepted_per_booking";

-- Commercial bookings now require a verified company (spec 3.3).
UPDATE "platform_settings" SET "value" = 'false'::jsonb WHERE "key" = 'allowPendingCompanyBookings';

-- Example additional charges on seeded rules (no-op on databases without these rules).
UPDATE "pricing_rules" SET "additionalCharge" = 1500, "additionalChargeLabel" = 'Heating charge' WHERE "name" = 'Heated tanker (any capacity)';
UPDATE "pricing_rules" SET "additionalCharge" = 1000, "additionalChargeLabel" = 'Hazardous goods handling' WHERE "name" = 'Petrol 20 KL (hazardous class A)';
