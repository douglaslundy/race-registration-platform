-- AlterTable
ALTER TABLE "events" ADD COLUMN "pixServiceFeeDiscountPercent" INTEGER;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "serviceFeeOriginalAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "pixDiscountPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "pixDiscountAmount" INTEGER NOT NULL DEFAULT 0;

-- Backfill: pedidos existentes nunca tiveram desconto; a Taxa de Serviço original é a que foi cobrada.
UPDATE "orders" SET "serviceFeeOriginalAmount" = "paymentFeeAmount"
WHERE "serviceFeeOriginalAmount" = 0 AND "paymentFeeAmount" > 0;
