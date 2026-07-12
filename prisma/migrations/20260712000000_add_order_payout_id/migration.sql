-- Order.payoutId: vincula um pedido ao repasse que o cobre, evitando contar o mesmo pedido em
-- dois repasses (repasses incrementais só pegam pedidos ainda com payoutId nulo)
ALTER TABLE "orders" ADD COLUMN "payoutId" TEXT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "transfer_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "orders_payoutId_idx" ON "orders"("payoutId");
