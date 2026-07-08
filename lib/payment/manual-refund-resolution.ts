import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export async function resolveRefundManually(params: {
  where: Prisma.PaymentWhereInput;
  resolvedByUserId: string;
  resolutionNote: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const payment = await db.payment.findFirst({ where: params.where, select: { id: true, status: true, orderId: true } });
  if (!payment) return { ok: false, status: 404, error: "Pagamento não encontrado" };

  if (payment.status !== "REFUND_PENDING") {
    return { ok: false, status: 400, error: "Este pagamento não está com estorno pendente" };
  }

  const refund = await db.refund.findFirst({
    where: { paymentId: payment.id, status: "FAILED" },
    orderBy: { createdAt: "desc" },
  });
  if (!refund) {
    return { ok: false, status: 400, error: "Nenhum registro de estorno pendente encontrado para este pagamento" };
  }

  await db.$transaction(async (tx) => {
    await tx.refund.update({
      where: { id: refund.id },
      data: { status: "MANUAL", processedAt: new Date(), resolutionNote: params.resolutionNote },
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "REFUNDED", refundedAt: new Date() },
    });

    await tx.order.update({
      where: { id: payment.orderId },
      data: { status: "REFUNDED" },
    });

    await tx.auditLog.create({
      data: {
        userId: params.resolvedByUserId,
        action: "PAYMENT_REFUND_MANUAL",
        entityType: "Payment",
        entityId: payment.id,
        metadata: { resolutionNote: params.resolutionNote },
      },
    });
  });

  return { ok: true };
}
