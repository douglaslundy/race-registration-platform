-- AlterTable
ALTER TABLE "advertiser_profiles"
  ADD COLUMN "document" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "address" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "instagram" TEXT,
  ADD COLUMN "facebook" TEXT;

ALTER TABLE "advertiser_profiles" ALTER COLUMN "document" DROP DEFAULT;
ALTER TABLE "advertiser_profiles" ALTER COLUMN "address" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ad_purchases" ADD COLUMN "rejectionReason" TEXT;
