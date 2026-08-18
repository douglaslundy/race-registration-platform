-- AlterTable
ALTER TABLE "events" ADD COLUMN     "organizerNameOverride" TEXT,
ADD COLUMN     "organizerDescriptionOverride" TEXT,
ADD COLUMN     "organizerEmailOverride" TEXT,
ADD COLUMN     "organizerPhoneOverride" TEXT;
