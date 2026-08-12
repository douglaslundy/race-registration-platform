-- AlterTable
ALTER TABLE "events" ADD COLUMN "shirtSizeRestrictionDate" TIMESTAMP(3);
ALTER TABLE "events" ADD COLUMN "shirtSizeRestrictionSizes" "ShirtSize"[] NOT NULL DEFAULT ARRAY[]::"ShirtSize"[];
