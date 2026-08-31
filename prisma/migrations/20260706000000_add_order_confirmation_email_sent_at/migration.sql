-- Marca quando o e-mail de confirmação de inscrição foi enviado com sucesso para o pedido
ALTER TABLE "orders" ADD COLUMN "confirmationEmailSentAt" TIMESTAMP(3);
