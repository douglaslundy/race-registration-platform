import type { Prisma, PaymentStatus, OrderStatus, RegistrationStatus } from "@prisma/client";

export type GatewayPaymentStatus = "PAID" | "EXPIRED" | "CANCELLED" | "REFUNDED" | "CHARGEBACK";
export type SyncSource = "webhook" | "reconciliation" | "refund_check";

const AUDIT_ACTION: Record<SyncSource, string> = {
  webhook: "PAYMENT_WEBHOOK",
  reconciliation: "PAYMENT_STATUS_SYNCED_RECONCILIATION",
  refund_check: "PAYMENT_STATUS_SYNCED_REFUND_CHECK",
};

interface SyncablePayment {
  id: string;
  status: PaymentStatus;
}

interface SyncableOrder {
  id: string;
  status: OrderStatus;
}

interface SyncableRegistration {
  id: string;
  ticketBatchId: string;
  status: RegistrationStatus;
}

export async function applyGatewayStatus(
  tx: Prisma.TransactionClient,
  payment: SyncablePayment,
  order: SyncableOrder,
  registrations: SyncableRegistration[],
  newStatus: GatewayPaymentStatus,
  source: SyncSource,
  options?: { paidAt?: Date; rawPayload?: unknown },
): Promise<{ changed: boolean }> {
  if (newStatus === payment.status) return { changed: false };
  if (payment.status === "REFUNDED" || payment.status === "CHARGEBACK") return { changed: false };

  const newOrderStatus =
    newStatus === "PAID" ? "PAID"
    : newStatus === "REFUNDED" || newStatus === "CHARGEBACK" ? "REFUNDED"
    : newStatus === "CANCELLED" || newStatus === "EXPIRED" ? "CANCELLED"
    : order.status;

  const newRegistrationStatus =
    newStatus === "PAID"
      ? "CONFIRMED"
      : newStatus === "CANCELLED" || newStatus === "EXPIRED" || newStatus === "REFUNDED" || newStatus === "CHARGEBACK"
        ? "CANCELLED"
        : undefined;

  const shouldReleaseCapacity =
    ((newStatus === "CANCELLED" || newStatus === "EXPIRED") && payment.status === "PENDING") ||
    ((newStatus === "REFUNDED" || newStatus === "CHARGEBACK") && payment.status === "PAID");

  const shouldRestoreCapacity =
    newStatus === "PAID" && (payment.status === "EXPIRED" || payment.status === "CANCELLED");

  // Uma inscrição só é elegível para liberar/restaurar vaga se ainda estiver no status que a
  // transição do pagamento pressupõe — evita decrementar/incrementar de novo uma inscrição que já
  // foi cancelada (ou já teve a vaga restaurada) por um fluxo independente (ex.: o atleta cancelou
  // a própria inscrição enquanto o pagamento seguia PAID).
  const releaseEligibleStatus: RegistrationStatus | undefined =
    payment.status === "PENDING" ? "PENDING_PAYMENT"
    : payment.status === "PAID" ? "CONFIRMED"
    : undefined;

  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: newStatus,
      ...(options?.paidAt ? { paidAt: options.paidAt } : {}),
      ...(newStatus === "REFUNDED" || newStatus === "CHARGEBACK" ? { refundedAt: new Date() } : {}),
      ...(options?.rawPayload !== undefined ? { rawPayload: options.rawPayload as Prisma.InputJsonValue } : {}),
    },
  });

  await tx.order.update({ where: { id: order.id }, data: { status: newOrderStatus } });

  if (newRegistrationStatus) {
    for (const r of registrations) {
      if (shouldReleaseCapacity && r.status !== releaseEligibleStatus) continue;
      if (shouldRestoreCapacity && r.status !== "CANCELLED") continue;
      await tx.registration.update({ where: { id: r.id }, data: { status: newRegistrationStatus } });
    }
  }

  if (shouldReleaseCapacity) {
    for (const r of registrations) {
      if (r.status === releaseEligibleStatus) {
        await tx.ticketBatch.update({ where: { id: r.ticketBatchId }, data: { soldCount: { decrement: 1 } } });
      }
    }
  }

  if (shouldRestoreCapacity) {
    for (const r of registrations) {
      if (r.status === "CANCELLED") {
        await tx.ticketBatch.update({ where: { id: r.ticketBatchId }, data: { soldCount: { increment: 1 } } });
      }
    }
  }

  await tx.auditLog.create({
    data: {
      userId: null,
      action: AUDIT_ACTION[source],
      entityType: "Payment",
      entityId: payment.id,
      metadata: { previousStatus: payment.status, newStatus },
    },
  });

  return { changed: true };
}
