-- AlterEnum
-- Adiciona o status intermediário usado enquanto um reembolso está sendo processado no gateway.
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUND_PENDING';

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PROCESSED', 'FAILED', 'MANUAL');

-- AlterTable
-- A coluna "status" é obrigatória no Prisma Client (sem @default, sempre setada
-- explicitamente na criação do Refund). Ela é adicionada aqui como NULLABLE porque
-- o Postgres exige um valor para colunas NOT NULL em linhas já existentes e esta
-- é uma feature ainda não lançada em produção (tabela "refunds" sem linhas que
-- dependam do formato antigo) — não há necessidade de backfill.
ALTER TABLE "refunds" ADD COLUMN "status" "RefundStatus";
ALTER TABLE "refunds" ADD COLUMN "failureReason" TEXT;
ALTER TABLE "refunds" ADD COLUMN "resolutionNote" TEXT;
