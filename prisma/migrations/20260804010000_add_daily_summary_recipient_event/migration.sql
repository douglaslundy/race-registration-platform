-- AlterTable
ALTER TABLE "daily_summary_recipients" ADD COLUMN "eventId" TEXT;

-- CreateIndex
CREATE INDEX "daily_summary_recipients_eventId_idx" ON "daily_summary_recipients"("eventId");

-- AddForeignKey
ALTER TABLE "daily_summary_recipients" ADD CONSTRAINT "daily_summary_recipients_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
