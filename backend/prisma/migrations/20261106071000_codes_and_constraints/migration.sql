-- Human-readable identifiers (CMP000001, TLB0000001, TKT000001, INV-000001, RCP-000001, TRP0000001).
-- Sequences guarantee uniqueness under concurrency; values are formatted by the application.
CREATE SEQUENCE IF NOT EXISTS company_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS booking_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS ticket_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS invoice_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS receipt_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS trip_code_seq START 1;

-- Financial and geographic sanity checks enforced by the database itself.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_amounts_positive"
  CHECK ("suggestedFreight" >= 0 AND "customerOffer" > 0 AND ("acceptedFreight" IS NULL OR "acceptedFreight" > 0) AND "distanceKm" > 0);
ALTER TABLE "transporter_offers" ADD CONSTRAINT "transporter_offers_amounts_positive"
  CHECK ("initialAmount" > 0 AND "currentAmount" > 0 AND "tankersAvailable" > 0);
ALTER TABLE "booking_allocations" ADD CONSTRAINT "booking_allocations_amount_positive" CHECK ("agreedFreight" > 0 AND "tankersAllocated" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts_non_negative" CHECK ("totalAmount" >= 0 AND "gstAmount" >= 0 AND "platformFee" >= 0);
ALTER TABLE "booking_requirements" ADD CONSTRAINT "booking_requirements_positive"
  CHECK ("tankerCapacityKl" > 0 AND "quantityKl" > 0 AND "numberOfTankers" > 0);

ALTER TABLE "booking_locations" ADD CONSTRAINT "booking_locations_coords"
  CHECK ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180);
ALTER TABLE "saved_locations" ADD CONSTRAINT "saved_locations_coords"
  CHECK ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180);
ALTER TABLE "trip_tracking" ADD CONSTRAINT "trip_tracking_coords"
  CHECK ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180);

-- A company can have at most one default pickup and one default delivery location.
CREATE UNIQUE INDEX "saved_locations_one_default_pickup" ON "saved_locations" ("companyId") WHERE "isDefaultPickup";
CREATE UNIQUE INDEX "saved_locations_one_default_delivery" ON "saved_locations" ("companyId") WHERE "isDefaultDelivery";

-- Phase 1 rule: at most one ACCEPTED offer per booking (prevents double booking even under races).
-- Drop this index when partial fulfilment across multiple transporters is enabled.
CREATE UNIQUE INDEX "transporter_offers_one_accepted_per_booking" ON "transporter_offers" ("bookingId") WHERE "status" = 'ACCEPTED';

-- Financial history must never be deleted.
CREATE OR REPLACE FUNCTION prevent_financial_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Deleting % rows is not allowed (financial history is immutable)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payments_no_delete BEFORE DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION prevent_financial_delete();
CREATE TRIGGER invoices_no_delete BEFORE DELETE ON "invoices" FOR EACH ROW EXECUTE FUNCTION prevent_financial_delete();
