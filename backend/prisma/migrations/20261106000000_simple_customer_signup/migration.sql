-- Simple signup (name + mobile + password) does not collect a location.
ALTER TABLE "Customer" ALTER COLUMN "city" DROP NOT NULL;
ALTER TABLE "Customer" ALTER COLUMN "state" DROP NOT NULL;
