import type { Prisma, PaymentStatus } from "@prisma/client";

interface AdPurchaseConfirmationPayment {
  id: string;
  status: string;
  adPurchase: {
    id: string;
    status: string;
    adPlan: { name: string; durationDays: number };
    advertiser: { user: { name: string; email: string } };
  };
}

interface ConfirmAdPurchaseResult {
  changed: boolean;
  advertiserEmail?: string;
  advertiserName?: string;
  planName?: string;
  endAt?: Date;
}

/**
 * Confirma (ou apenas sincroniza o status de) um pagamento de compra de plano de anúncio
 * (`AdPurchase`). Chamado pelo webhook de pagamento quando `payment.adPurchaseId` está
 * preenchido — nunca toca em `Order`/`Registration`. Espelha o guard de status obsoleto/terminal
 * e o padrão de transação de `applyGatewayStatus` (lib/payment/sync-payment-status.ts): recebe o
 * `payment` já carregado e o `tx` da transação, só usa o client para escrever.
 */
export async function confirmAdPurchasePayment(
  tx: Prisma.TransactionClient,
  payment: AdPurchaseConfirmationPayment,
  newStatus: string,
): Promise<ConfirmAdPurchaseResult> {
  if (newStatus === payment.status) return { changed: false };
  if (payment.status === "REFUNDED" || payment.status === "CHARGEBACK") return { changed: false };

  await tx.payment.update({
    where: { id: payment.id },
    data: { status: newStatus as PaymentStatus },
  });

  if (newStatus !== "PAID") return { changed: false };
  if (payment.adPurchase.status === "PAID") return { changed: false }; // idempotente, webhook pode repetir

  const startAt = new Date();
  const endAt = new Date(startAt.getTime() + payment.adPurchase.adPlan.durationDays * 24 * 60 * 60 * 1000);

  await tx.adPurchase.update({
    where: { id: payment.adPurchase.id },
    data: { status: "PAID", startAt, endAt },
  });

  return {
    changed: true,
    advertiserEmail: payment.adPurchase.advertiser.user.email,
    advertiserName: payment.adPurchase.advertiser.user.name,
    planName: payment.adPurchase.adPlan.name,
    endAt,
  };
}
