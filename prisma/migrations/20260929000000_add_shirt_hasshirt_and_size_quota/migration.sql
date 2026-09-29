-- AlterTable
ALTER TABLE "ticket_batches" ADD COLUMN "hasShirt" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "event_shirt_size_quotas" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "size" "ShirtSize" NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "event_shirt_size_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_shirt_size_quotas_eventId_size_key" ON "event_shirt_size_quotas"("eventId", "size");

-- AddForeignKey
ALTER TABLE "event_shirt_size_quotas" ADD CONSTRAINT "event_shirt_size_quotas_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
