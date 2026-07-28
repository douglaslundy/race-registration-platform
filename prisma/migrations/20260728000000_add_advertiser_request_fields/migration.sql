-- AlterTable
ALTER TABLE "advertiser_profiles"
  ADD COLUMN "document" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "instagram" TEXT,
  ADD COLUMN "facebook" TEXT;

-- AlterTable
ALTER TABLE "ad_purchases" ADD COLUMN "rejectionReason" TEXT;
