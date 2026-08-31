-- CreateTable
CREATE TABLE "event_result_files" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_result_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_result_files_eventId_idx" ON "event_result_files"("eventId");

-- AddForeignKey
ALTER TABLE "event_result_files" ADD CONSTRAINT "event_result_files_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_result_files" ADD CONSTRAINT "event_result_files_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "events" ADD COLUMN "resultsSubtitle" VARCHAR(120);
