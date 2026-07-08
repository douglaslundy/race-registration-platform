-- AlterEnum
-- Adiciona o status intermediário usado enquanto um reembolso está sendo processado no gateway.
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUND_PENDING';

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PROCESSED', 'FAILED', 'MANUAL');

-- AlterTable
-- A coluna "status" é obrigatória no Prisma Client (sem @default, sempre setada
-- explicitamente na criação do Refund). É segura como NOT NULL direto (sem
-- backfill) porque esta é uma feature ainda não lançada em produção — a tabela
-- "refunds" não tem linhas existentes que dependam do formato antigo.
ALTER TABLE "refunds" ADD COLUMN "status" "RefundStatus" NOT NULL;
ALTER TABLE "refunds" ADD COLUMN "failureReason" TEXT;
ALTER TABLE "refunds" ADD COLUMN "resolutionNote" TEXT;
