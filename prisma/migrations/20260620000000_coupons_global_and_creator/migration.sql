-- Cupom global: eventId passa a ser opcional (NULL = vale para todos os eventos)
ALTER TABLE "coupons" ALTER COLUMN "eventId" DROP NOT NULL;

-- Rastreamento: quem criou o cupom
ALTER TABLE "coupons" ADD COLUMN "createdById" TEXT;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "coupons_code_idx" ON "coupons"("code");
