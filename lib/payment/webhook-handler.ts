import { db } from "@/lib/db";
import { applyGatewayStatus } from "@/lib/payment/sync-payment-status";
import { notifyOrderConfirmed } from "@/lib/notifications";
import { notifyPaymentError } from "@/lib/alerts/payment-error";
import { confirmAdPurchasePayment } from "@/lib/ads/ad-purchase-confirmation";
import { sendAdPurchaseConfirmationEmail } from "@/lib/email";
import { notifyAdvertiserRequestPending } from "@/lib/alerts/advertiser-request-pending";
import type { PaymentWebhookPayload } from "./types";

export interface ParsedWebhookEvent {
  providerPaymentId: string;
  status: PaymentWebhookPayload["status"];
  paidAt?: string;
  gatewayFeeAmount?: number;
  rawPayload: Record<string, unknown>;
  /**
   * Quando o evento vem do endpoint de webhook por-conta, força o handler a exigir
   * `payment.paymentAccountId === accountId` antes de aplicar qualquer mudança.
   * `undefined` no endpoint legado (single-account), que aceita qualquer conta.
   */
  accountId?: string;
}

export async function processPaymentWebhookEvent(
  event: ParsedWebhookEvent,
): Promise<{ handled: boolean }> {
  const payment = await db.payment.findFirst({
    where: { providerPaymentId: event.providerPaymentId },
    include: {
      order: { include: { registrations: true, buyer: { select: { name: true, email: true } } } },
      adPurchase: { include: { advertiser: { include: { user: true } }, adPlan: true } },
    },
  });

  if (!payment) return { handled: false };

  if (event.accountId && payment.paymentAccountId && payment.paymentAccountId !== event.accountId) {
    console.warn(
      `[webhooks/payment] payment ${payment.id} pertence à conta ${payment.paymentAccountId}, mas o webhook chegou pela conta ${event.accountId} — ignorando evento`,
    );
    return { handled: false };
  }

  if (payment.adPurchaseId) {
    // Pagamento de compra de plano de anúncio (AdPurchase) — não passa pelo fluxo de
    // Order/Registration abaixo, que assume payment.order não-nulo.
    const adPurchase = payment.adPurchase;
    if (!adPurchase) {
      console.error(`[webhooks/payment] payment ${payment.id} tem adPurchaseId mas adPurchase não veio no include — ignorando evento`);
      return { handled: false };
    }
    const result = await db.$transaction((tx) => confirmAdPurchasePayment(tx, { ...payment, adPurchase }, event.status));
    if (result.changed && result.advertiserEmail && result.advertiserName && result.planName && result.endAt) {
      try {
        await sendAdPurchaseConfirmationEmail({
          to: result.advertiserEmail,
          name: result.advertiserName,
          planName: result.planName,
          endAt: result.endAt,
        });
      } catch (err) {
        console.error(`[webhooks/payment] falha ao enviar e-mail de confirmação de compra de anúncio para adPurchase ${adPurchase.id}:`, err);
      }
    }
    if (result.wentToPendingApproval) {
      await notifyAdvertiserRequestPending(adPurchase.id);
    }
    return { handled: true };
  }

  if (!payment.order || !payment.orderId) {
    // Chegou aqui um pagamento sem Order E sem AdPurchase associado (o branch de AdPurchase já
    // retornou acima) — loga bem alto em vez de tentar sincronizar um pedido inexistente, mas
    // ainda confirma o recebimento (ok:true) pro gateway não ficar reenviando.
    console.error(`[webhooks/payment] payment ${payment.id} sem order associado — ignorando evento`);
    return { handled: false };
  }

  const order = payment.order;
  const orderId = payment.orderId;

  const newPaymentStatus = event.status;

  const result = await db.$transaction(async (tx) => {
    return applyGatewayStatus(
      tx,
      payment,
      order,
      order.registrations,
      newPaymentStatus,
      "webhook",
      {
        paidAt: event.paidAt ? new Date(event.paidAt) : undefined,
        gatewayFeeAmount: event.gatewayFeeAmount,
        rawPayload: event.rawPayload,
      },
    );
  });

  if (!result.changed) return { handled: true };

  // Envia a confirmação de inscrição por e-mail quando o pagamento é aprovado
  if (newPaymentStatus === "PAID") {
    void notifyOrderConfirmed(orderId);
  }

  // Avisa o atleta quando o pagamento falha ou expira
  if (newPaymentStatus === "CANCELLED" || newPaymentStatus === "EXPIRED") {
    void notifyPaymentError(payment.id);
  }

  return { handled: true };
}
