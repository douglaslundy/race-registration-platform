import { db } from "@/lib/db";

export interface PendingCancellation {
  id: string;
  createdAt: Date;
  cancellationReason: string | null;
  cancellationRequestedAt: Date | null;
  participantName: string;
  participantEmail: string;
  event: { id: string; title: string };
  hasPaidPayment: boolean;
}

export interface PendingRefund {
  id: string;
  amount: number;
  order: { id: string };
  event: { id: string; title: string };
  athlete: { name: string; email: string };
  latestFailedRefund: { failureReason: string | null; createdAt: Date } | null;
}

export async function listPendingCancellations(organizerUserId?: string): Promise<PendingCancellation[]> {
  const registrations = await db.registration.findMany({
    where: {
      status: "CANCELLATION_REQUESTED",
      ...(organizerUserId ? { event: { organizer: { userId: organizerUserId } } } : {}),
    },
    orderBy: { cancellationRequestedAt: "asc" },
    select: {
      id: true,
      createdAt: true,
      cancellationReason: true,
      cancellationRequestedAt: true,
      participantName: true,
      participantEmail: true,
      event: { select: { id: true, title: true } },
      order: { select: { payments: { where: { status: "PAID" }, take: 1, select: { id: true } } } },
    },
  });
  return registrations.map(({ order, ...r }) => ({ ...r, hasPaidPayment: order.payments.length > 0 }));
}

export async function listPendingRefunds(organizerUserId?: string): Promise<PendingRefund[]> {
  const payments = await db.payment.findMany({
    where: {
      status: "REFUND_PENDING",
      ...(organizerUserId ? { order: { event: { organizer: { userId: organizerUserId } } } } : {}),
    },
    orderBy: { updatedAt: "asc" },
    select: {
      id: true,
      amount: true,
      order: {
        select: {
          id: true,
          event: { select: { id: true, title: true } },
          buyer: { select: { name: true, email: true } },
        },
      },
      refunds: {
        where: { status: "FAILED" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { failureReason: true, createdAt: true },
      },
    },
  });

  return payments.map((p) => {
    if (!p.order) {
      // Esta fila só cobre pagamentos de Order (checkout) com estorno pendente. Se um pagamento de
      // AdPurchase aparecer aqui, falha alto em vez de omitir a linha silenciosamente.
      throw new Error(`Payment ${p.id} sem order associado (listPendingRefunds)`);
    }
    return {
      id: p.id,
      amount: p.amount,
      order: { id: p.order.id },
      event: p.order.event,
      athlete: p.order.buyer,
      latestFailedRefund: p.refunds[0] ?? null,
    };
  });
}
