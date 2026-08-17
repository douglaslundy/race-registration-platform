-- CreateTable
CREATE TABLE "kit_deliveries" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredByUserId" TEXT NOT NULL,
    "receivedByName" TEXT NOT NULL,
    "receivedByDocument" TEXT,

    CONSTRAINT "kit_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kit_deliveries_registrationId_key" ON "kit_deliveries"("registrationId");

-- CreateIndex
CREATE INDEX "kit_deliveries_deliveredByUserId_idx" ON "kit_deliveries"("deliveredByUserId");

-- AddForeignKey
ALTER TABLE "kit_deliveries" ADD CONSTRAINT "kit_deliveries_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_deliveries" ADD CONSTRAINT "kit_deliveries_deliveredByUserId_fkey" FOREIGN KEY ("deliveredByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
