import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";
import { applyGatewayStatus } from "./sync-payment-status";

export interface RefundPaymentParams {
  paymentId: string;
  initiatedByUserId: string;
  reason?: string;
}

export interface RefundPaymentResult {
  alreadySynced: boolean;
}

export async function refundPayment(params: RefundPaymentParams): Promise<RefundPaymentResult> {
  const payment = await db.payment.findUnique({
    where: { id: params.paymentId },
    include: { order: { include: { registrations: true } } },
  });

  if (!payment) throw new Error("Pagamento não encontrado");
  if (payment.status !== "PAID") throw new Error("Só é possível estornar pagamentos com status Pago");
  if (!payment.providerPaymentId) throw new Error("Pagamento sem referência no gateway");

  const provider = await getPaymentProvider();

  const gatewayStatus = await provider.checkPaymentStatus(payment.providerPaymentId);
  if (gatewayStatus === "REFUNDED" || gatewayStatus === "CHARGEBACK") {
    await db.$transaction(async (tx) => {
      await applyGatewayStatus(tx, payment, payment.order, payment.order.registrations, gatewayStatus, "refund_check");
    });
    return { alreadySynced: true };
  }

  const result = await provider.refundPayment({ providerPaymentId: payment.providerPaymentId });

  await db.$transaction(async (tx) => {
    await tx.refund.create({
      data: {
        paymentId: payment.id,
        amount: payment.amount,
        reason: params.reason,
        processedAt: new Date(),
        providerRefundId: result.providerRefundId,
        initiatedByUserId: params.initiatedByUserId,
      },
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "REFUNDED", refundedAt: new Date() },
    });

    await tx.order.update({
      where: { id: payment.orderId },
      data: { status: "REFUNDED" },
    });

    for (const registration of payment.order.registrations) {
      if (registration.status === "CONFIRMED") {
        await tx.registration.update({
          where: { id: registration.id },
          data: { status: "CANCELLED" },
        });
        await tx.ticketBatch.update({
          where: { id: registration.ticketBatchId },
          data: { soldCount: { decrement: 1 } },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        userId: params.initiatedByUserId,
        action: "PAYMENT_REFUNDED",
        entityType: "Payment",
        entityId: payment.id,
        metadata: { orderId: payment.orderId, amount: payment.amount, reason: params.reason ?? null },
      },
    });
  });

  return { alreadySynced: false };
}
