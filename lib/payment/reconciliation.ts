import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";
import { getReconciliationAlertSettings } from "@/lib/alerts/alert-settings";

export interface PaymentMismatch {
  paymentId: string;
  orderId: string;
  eventTitle: string;
  localStatus: string;
  gatewayStatus: string;
}

export async function reconcilePayments(options?: { organizerUserId?: string }): Promise<{ checked: number; mismatches: PaymentMismatch[] }> {
  const settings = await getReconciliationAlertSettings();
  const cutoff = new Date(Date.now() - settings.minutesThreshold * 60 * 1000);

  const payments = await db.payment.findMany({
    where: {
      status: "PENDING",
      providerPaymentId: { not: null },
      createdAt: { lte: cutoff },
      ...(options?.organizerUserId
        ? { order: { event: { organizer: { userId: options.organizerUserId } } } }
        : {}),
    },
    select: {
      id: true,
      providerPaymentId: true,
      status: true,
      order: { select: { id: true, event: { select: { title: true } } } },
    },
  });

  const provider = await getPaymentProvider();
  const mismatches: PaymentMismatch[] = [];

  for (const payment of payments) {
    try {
      const gatewayStatus = await provider.checkPaymentStatus(payment.providerPaymentId as string);
      if (gatewayStatus !== payment.status) {
        mismatches.push({
          paymentId: payment.id,
          orderId: payment.order.id,
          eventTitle: payment.order.event.title,
          localStatus: payment.status,
          gatewayStatus,
        });
      }
    } catch (err) {
      console.error("[reconcilePayments] failed to check payment", payment.id, err);
    }
  }

  return { checked: payments.length, mismatches };
}
