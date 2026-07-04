import type { Prisma } from "@prisma/client";

export type GatewayPaymentStatus = "PAID" | "EXPIRED" | "CANCELLED" | "REFUNDED" | "CHARGEBACK";
export type SyncSource = "webhook" | "reconciliation" | "refund_check";

const AUDIT_ACTION: Record<SyncSource, string> = {
  webhook: "PAYMENT_WEBHOOK",
  reconciliation: "PAYMENT_STATUS_SYNCED_RECONCILIATION",
  refund_check: "PAYMENT_STATUS_SYNCED_REFUND_CHECK",
};

interface SyncablePayment {
  id: string;
  status: string;
}

interface SyncableOrder {
  id: string;
  status: string;
}

interface SyncableRegistration {
  id: string;
  ticketBatchId: string;
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
    : newStatus === "REFUNDED" ? "REFUNDED"
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
      await tx.registration.update({ where: { id: r.id }, data: { status: newRegistrationStatus } });
    }
  }

  if (shouldReleaseCapacity) {
    for (const r of registrations) {
      await tx.ticketBatch.update({ where: { id: r.ticketBatchId }, data: { soldCount: { decrement: 1 } } });
    }
  }

  if (shouldRestoreCapacity) {
    for (const r of registrations) {
      await tx.ticketBatch.update({ where: { id: r.ticketBatchId }, data: { soldCount: { increment: 1 } } });
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
