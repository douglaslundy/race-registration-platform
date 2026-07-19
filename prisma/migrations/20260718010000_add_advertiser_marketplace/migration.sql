-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'ADVERTISER';

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "payments" ADD COLUMN "adPurchaseId" TEXT;

-- CreateTable
CREATE TABLE "advertiser_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advertiser_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "advertiser_profiles_userId_key" ON "advertiser_profiles"("userId");

-- CreateTable
CREATE TABLE "ad_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceAmount" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "maxSimultaneousSlots" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_purchases" (
    "id" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "adPlanId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "private_ads" (
    "id" TEXT NOT NULL,
    "adPurchaseId" TEXT NOT NULL,
    "adSlotId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "private_ads_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_adPurchaseId_fkey" FOREIGN KEY ("adPurchaseId") REFERENCES "ad_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "advertiser_profiles" ADD CONSTRAINT "advertiser_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ad_purchases" ADD CONSTRAINT "ad_purchases_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "advertiser_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ad_purchases" ADD CONSTRAINT "ad_purchases_adPlanId_fkey" FOREIGN KEY ("adPlanId") REFERENCES "ad_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "private_ads" ADD CONSTRAINT "private_ads_adPurchaseId_fkey" FOREIGN KEY ("adPurchaseId") REFERENCES "ad_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "private_ads" ADD CONSTRAINT "private_ads_adSlotId_fkey" FOREIGN KEY ("adSlotId") REFERENCES "ad_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: 3 planos iniciais
INSERT INTO "ad_plans" ("id", "name", "priceAmount", "durationDays", "maxSimultaneousSlots", "active", "updatedAt") VALUES
  ('adplan_basico', 'Básico', 9900, 30, 1, true, CURRENT_TIMESTAMP),
  ('adplan_intermediario', 'Intermediário', 24900, 30, 3, true, CURRENT_TIMESTAMP),
  ('adplan_premium', 'Premium', 49900, 60, 5, true, CURRENT_TIMESTAMP);
