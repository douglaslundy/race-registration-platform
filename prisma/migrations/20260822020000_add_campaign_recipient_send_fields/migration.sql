-- AlterTable
ALTER TABLE "campaign_recipients" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "campaign_recipients" ADD COLUMN "providerMessageId" TEXT;
ALTER TABLE "campaign_recipients" ADD COLUMN "sentAt" TIMESTAMP(3);
