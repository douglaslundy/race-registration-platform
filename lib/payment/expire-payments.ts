import { db } from "@/lib/db";
import { notifyPaymentError } from "@/lib/alerts/payment-error";

export async function cancelExpiredPayment(paymentId: string): Promise<boolean> {
  const cancelled = await db.$transaction(async (tx) => {
    const result = await tx.payment.updateMany({
      where: { id: paymentId, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    if (result.count === 0) return false;

    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: {
        orderId: true,
        order: { select: { registrations: { select: { id: true, ticketBatchId: true, status: true } } } },
      },
    });

    await tx.order.update({ where: { id: payment.orderId }, data: { status: "CANCELLED" } });

    for (const r of payment.order.registrations) {
      if (r.status !== "PENDING_PAYMENT") continue;
      await tx.registration.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
      await tx.ticketBatch.update({ where: { id: r.ticketBatchId }, data: { soldCount: { decrement: 1 } } });
    }

    await tx.auditLog.create({
      data: {
        action: "PAYMENT_AUTO_EXPIRED",
        entityType: "Payment",
        entityId: paymentId,
        metadata: { orderId: payment.orderId },
      },
    });

    return true;
  });

  if (cancelled) {
    void notifyPaymentError(paymentId);
  }

  return cancelled;
}

export async function expirePendingPayments(options?: { organizerUserId?: string }): Promise<{ checked: number; expired: number }> {
  const payments = await db.payment.findMany({
    where: {
      status: "PENDING",
      expiresAt: { not: null, lt: new Date() },
      ...(options?.organizerUserId
        ? { order: { event: { organizer: { userId: options.organizerUserId } } } }
        : {}),
    },
    select: { id: true },
  });

  let expired = 0;

  for (const payment of payments) {
    try {
      if (await cancelExpiredPayment(payment.id)) expired++;
    } catch (err) {
      console.error("[expirePendingPayments] failed to expire payment", payment.id, err);
    }
  }

  return { checked: payments.length, expired };
}

export async function cancelAbandonedOrder(orderId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const result = await tx.order.updateMany({
      where: { id: orderId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    if (result.count === 0) return false;

    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { registrations: { select: { id: true, ticketBatchId: true, status: true } } },
    });

    for (const r of order.registrations) {
      if (r.status !== "PENDING_PAYMENT") continue;
      await tx.registration.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
      await tx.ticketBatch.update({ where: { id: r.ticketBatchId }, data: { soldCount: { decrement: 1 } } });
    }

    await tx.auditLog.create({
      data: { action: "ORDER_ABANDONED_EXPIRED", entityType: "Order", entityId: orderId, metadata: {} },
    });

    return true;
  });
}

export async function expireAbandonedOrders(options?: { organizerUserId?: string }): Promise<{ checked: number; expired: number }> {
  const orders = await db.order.findMany({
    where: {
      status: "PENDING",
      expiresAt: { not: null, lt: new Date() },
      payments: { none: {} },
      ...(options?.organizerUserId
        ? { event: { organizer: { userId: options.organizerUserId } } }
        : {}),
    },
    select: { id: true },
  });

  let expired = 0;

  for (const order of orders) {
    try {
      if (await cancelAbandonedOrder(order.id)) expired++;
    } catch (err) {
      console.error("[expireAbandonedOrders] failed to expire order", order.id, err);
    }
  }

  return { checked: orders.length, expired };
}
