import { db } from "@/lib/db";
import { refundPayment } from "@/lib/payment/refund-service";

export interface AttemptAutoRefundParams {
  payment: { id: string; amount: number };
  initiatedByUserId: string;
  reason?: string;
}

export type AttemptAutoRefundResult =
  | { outcome: "processed" | "already_synced" }
  | { outcome: "failed"; failureReason: string };

/**
 * Tenta estornar automaticamente via gateway. Ao contrário de `refundPayment`,
 * nunca lança exceção: se o gateway falhar, marca o pagamento como
 * REFUND_PENDING e registra um Refund FAILED para resolução manual depois
 * (ver lib/payment/manual-refund-resolution.ts).
 */
export async function attemptAutoRefund(params: AttemptAutoRefundParams): Promise<AttemptAutoRefundResult> {
  try {
    const result = await refundPayment({
      paymentId: params.payment.id,
      initiatedByUserId: params.initiatedByUserId,
      reason: params.reason,
    });
    return { outcome: result.alreadySynced ? "already_synced" : "processed" };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : "Erro desconhecido ao estornar";

    await db.$transaction(async (tx) => {
      await tx.refund.create({
        data: {
          paymentId: params.payment.id,
          amount: params.payment.amount,
          reason: params.reason,
          status: "FAILED",
          failureReason,
          initiatedByUserId: params.initiatedByUserId,
        },
      });

      await tx.payment.update({
        where: { id: params.payment.id },
        data: { status: "REFUND_PENDING" },
      });
    });

    return { outcome: "failed", failureReason };
  }
}
