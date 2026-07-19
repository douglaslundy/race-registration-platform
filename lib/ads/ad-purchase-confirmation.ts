import type { PaymentStatus } from "@prisma/client";
import { db } from "../db";
import { sendAdPurchaseConfirmationEmail } from "../email";

/**
 * Confirma (ou apenas sincroniza o status de) um pagamento de compra de plano de anúncio
 * (`AdPurchase`). Chamado pelo webhook de pagamento quando `payment.adPurchaseId` está
 * preenchido — nunca toca em `Order`/`Registration`.
 */
export async function confirmAdPurchasePayment(paymentId: string, status: string): Promise<void> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { adPurchase: { include: { advertiser: { include: { user: true } }, adPlan: true } } },
  });
  if (!payment?.adPurchase) return;

  await db.payment.update({ where: { id: paymentId }, data: { status: status as PaymentStatus } });

  if (status !== "PAID") return;
  if (payment.adPurchase.status === "PAID") return; // idempotente, webhook pode repetir

  const startAt = new Date();
  const endAt = new Date(startAt.getTime() + payment.adPurchase.adPlan.durationDays * 24 * 60 * 60 * 1000);

  await db.adPurchase.update({
    where: { id: payment.adPurchase.id },
    data: { status: "PAID", startAt, endAt },
  });

  await sendAdPurchaseConfirmationEmail({
    to: payment.adPurchase.advertiser.user.email,
    name: payment.adPurchase.advertiser.user.name,
    planName: payment.adPurchase.adPlan.name,
    endAt,
  });
}
