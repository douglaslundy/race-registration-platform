-- CreateEnum
CREATE TYPE "DailySummaryRecipientType" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateTable
CREATE TABLE "daily_summary_recipients" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DailySummaryRecipientType" NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_summary_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_summary_recipients_userId_idx" ON "daily_summary_recipients"("userId");

-- AddForeignKey
ALTER TABLE "daily_summary_recipients" ADD CONSTRAINT "daily_summary_recipients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
