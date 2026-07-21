-- Garante que todo Payment pertence a exatamente um dos dois: um Order (inscricao) ou um
-- AdPurchase (compra de plano de anuncio) -- nunca os dois, nunca nenhum. Ate aqui isso so era
-- garantido "por construcao" no codigo (lib/checkout.ts e lib/checkout-ads.ts), sem garantia no
-- banco.
--
-- ATENCAO: o deploy deste projeto usa `prisma db push --skip-generate`, que NAO executa arquivos
-- migration.sql (ver memoria deploy_vps_process). Este ALTER TABLE precisa ser aplicado
-- manualmente via psql no proximo deploy -- mesmo padrao ja usado pros seeds de AdPlan/AdSlot do
-- sub-projeto de marketplace. Confirmado em 2026-07-21 que as 147 linhas de producao ja respeitam
-- essa regra (0 violacoes), entao e seguro aplicar sem quebrar dados existentes.

ALTER TABLE payments
  ADD CONSTRAINT payment_order_xor_adpurchase_check
  CHECK (
    ((("orderId" IS NOT NULL))::int + (("adPurchaseId" IS NOT NULL))::int) = 1
  );
