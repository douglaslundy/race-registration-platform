-- CreateTable "payment_accounts"
CREATE TABLE "payment_accounts" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mercadopago',
    "accessToken" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "publicKey" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_accounts_isDefault_idx" ON "payment_accounts"("isDefault");

-- AlterTable "events"
ALTER TABLE "events" ADD COLUMN "paymentAccountId" TEXT;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable "payments"
ALTER TABLE "payments" ADD COLUMN "paymentAccountId" TEXT;

-- CreateIndex
CREATE INDEX "payments_paymentAccountId_idx" ON "payments"("paymentAccountId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
