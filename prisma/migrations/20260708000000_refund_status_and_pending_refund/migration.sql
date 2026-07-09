-- AlterEnum
-- Adiciona o status intermediário usado enquanto um reembolso está sendo processado no gateway.
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUND_PENDING';

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PROCESSED', 'FAILED', 'MANUAL');

-- AlterTable
-- A coluna "status" é obrigatória no Prisma Client (sem @default, sempre setada
-- explicitamente na criação do Refund). A suposição original de que a tabela
-- "refunds" estava vazia estava errada (produção já tinha linhas reais) — por
-- isso o backfill abaixo: linhas existentes só puderam ter sido criadas pelo
-- único caminho de estorno que existia antes desta feature (sucesso síncrono
-- no gateway), então "PROCESSED" é o valor correto para elas.
ALTER TABLE "refunds" ADD COLUMN "status" "RefundStatus";
UPDATE "refunds" SET "status" = 'PROCESSED' WHERE "status" IS NULL;
ALTER TABLE "refunds" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "refunds" ADD COLUMN "failureReason" TEXT;
ALTER TABLE "refunds" ADD COLUMN "resolutionNote" TEXT;
