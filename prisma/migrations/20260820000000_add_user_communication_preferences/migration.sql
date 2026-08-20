-- AlterTable
ALTER TABLE "users" ADD COLUMN     "receivePromotionalMessages" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "receiveEventMessages" BOOLEAN NOT NULL DEFAULT true;
