import type { Prisma, PaymentStatus, OrderStatus, RegistrationStatus } from "@prisma/client";

export type GatewayPaymentStatus = "PAID" | "EXPIRED" | "CANCELLED" | "REFUNDED" | "CHARGEBACK";
/**
 * Aprovação tardia (pagamento EXPIRED/CANCELLED que o gateway diz estar PAID) que não pode reativar
 * a inscrição porque o lote já esgotou depois que a vaga foi liberada. Lançado de dentro da
 * transação — o rollback desfaz qualquer escrita parcial. O pagamento fica como estava localmente
 * e o caso vai para decisão manual (estorno ou ampliar o lote), em vez de causar overbooking.
 */
export class NoCapacityError extends Error {
  constructor(public readonly ticketBatchId: string) {
    super(`Lote ${ticketBatchId} sem vaga para reativar a inscrição de uma aprovação tardia`);
    this.name = "NoCapacityError";
  }
}

export type SyncSource = "webhook" | "reconciliation" | "refund_check" | "checkout" | "status_poll";

const AUDIT_ACTION: Record<SyncSource, string> = {
  webhook: "PAYMENT_WEBHOOK",
  reconciliation: "PAYMENT_STATUS_SYNCED_RECONCILIATION",
  refund_check: "PAYMENT_STATUS_SYNCED_REFUND_CHECK",
  checkout: "PAYMENT_CARD_REJECTED",
  status_poll: "PAYMENT_STATUS_SYNCED_POLL",
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
  options?: { paidAt?: Date; rawPayload?: unknown; gatewayFeeAmount?: number },
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

  // Compare-and-set: só transiciona se o pagamento ainda está no status que o chamador leu. Se um
  // webhook/poller/conciliação concorrente já aplicou a transição (o `payment.status` recebido está
  // obsoleto), `count` volta 0 e abortamos antes de mexer em pedido, inscrição e vaga — evita
  // decrementar/incrementar `soldCount` em dobro e notificação duplicada. O UPDATE também trava a
  // linha até o fim da transação, serializando os concorrentes.
  const claimed = await tx.payment.updateMany({
    where: { id: payment.id, status: payment.status },
    data: {
      status: newStatus,
      ...(options?.paidAt ? { paidAt: options.paidAt } : {}),
      ...(options?.gatewayFeeAmount !== undefined ? { gatewayFeeAmount: options.gatewayFeeAmount } : {}),
      ...(newStatus === "REFUNDED" || newStatus === "CHARGEBACK" ? { refundedAt: new Date() } : {}),
      ...(options?.rawPayload !== undefined ? { rawPayload: options.rawPayload as Prisma.InputJsonValue } : {}),
    },
  });
  if (claimed.count === 0) return { changed: false };

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
        // Incremento condicional atômico: só ocupa a vaga se ainda houver (soldCount < capacity).
        const claimedSeat = await tx.$executeRaw`UPDATE "ticket_batches" SET "soldCount" = "soldCount" + 1 WHERE "id" = ${r.ticketBatchId} AND "soldCount" < "capacity"`;
        if (claimedSeat === 0) throw new NoCapacityError(r.ticketBatchId);
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
