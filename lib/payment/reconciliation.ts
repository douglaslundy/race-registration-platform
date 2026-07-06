import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment";
import { getReconciliationAlertSettings } from "@/lib/alerts/alert-settings";
import { applyGatewayStatus } from "./sync-payment-status";

export interface PaymentMismatch {
  paymentId: string;
  orderId: string;
  eventTitle: string;
  localStatus: string;
  gatewayStatus: string;
  corrected: boolean;
}

const PAID_LOOKBACK_DAYS = 90;
const LATE_APPROVAL_LOOKBACK_DAYS = 7;

type Provider = Awaited<ReturnType<typeof getPaymentProvider>>;

export async function reconcilePayments(options?: { organizerUserId?: string }): Promise<{ checked: number; mismatches: PaymentMismatch[] }> {
  const settings = await getReconciliationAlertSettings();
  const cutoff = new Date(Date.now() - settings.minutesThreshold * 60 * 1000);
  const organizerFilter = options?.organizerUserId
    ? { order: { event: { organizer: { userId: options.organizerUserId } } } }
    : {};

  const provider = await getPaymentProvider();

  const pending = await checkPendingMismatches(provider, cutoff, organizerFilter);
  const paid = await checkPaidMismatches(provider, organizerFilter);
  const lateApproval = await checkLateApprovalMismatches(provider, organizerFilter);

  return {
    checked: pending.checked + paid.checked + lateApproval.checked,
    mismatches: [...pending.mismatches, ...paid.mismatches, ...lateApproval.mismatches],
  };
}

async function checkPendingMismatches(
  provider: Provider,
  cutoff: Date,
  organizerFilter: Record<string, unknown>,
): Promise<{ checked: number; mismatches: PaymentMismatch[] }> {
  const payments = await db.payment.findMany({
    where: {
      status: "PENDING",
      providerPaymentId: { not: null },
      createdAt: { lte: cutoff },
      ...organizerFilter,
    },
    select: {
      id: true,
      providerPaymentId: true,
      status: true,
      order: { select: { id: true, event: { select: { title: true } } } },
    },
  });

  const mismatches: PaymentMismatch[] = [];
  for (const payment of payments) {
    try {
      const { status: gatewayStatus } = await provider.checkPaymentStatus(payment.providerPaymentId as string);
      if (gatewayStatus !== payment.status) {
        mismatches.push({
          paymentId: payment.id,
          orderId: payment.order.id,
          eventTitle: payment.order.event.title,
          localStatus: payment.status,
          gatewayStatus,
          corrected: false,
        });
      }
    } catch (err) {
      console.error("[reconcilePayments] failed to check pending payment", payment.id, err);
    }
  }

  return { checked: payments.length, mismatches };
}

async function checkPaidMismatches(
  provider: Provider,
  organizerFilter: Record<string, unknown>,
): Promise<{ checked: number; mismatches: PaymentMismatch[] }> {
  const cutoff = new Date(Date.now() - PAID_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const payments = await db.payment.findMany({
    where: {
      status: "PAID",
      providerPaymentId: { not: null },
      paidAt: { gte: cutoff },
      ...organizerFilter,
    },
    select: {
      id: true,
      providerPaymentId: true,
      status: true,
      orderId: true,
      order: {
        select: {
          id: true,
          status: true,
          event: { select: { title: true } },
          registrations: { select: { id: true, ticketBatchId: true, status: true } },
        },
      },
    },
  });

  const mismatches: PaymentMismatch[] = [];
  for (const payment of payments) {
    try {
      const { status: gatewayStatus } = await provider.checkPaymentStatus(payment.providerPaymentId as string);
      if (gatewayStatus === "REFUNDED" || gatewayStatus === "CHARGEBACK") {
        await db.$transaction(async (tx) => {
          await applyGatewayStatus(tx, payment, payment.order, payment.order.registrations, gatewayStatus, "reconciliation");
        });
        mismatches.push({
          paymentId: payment.id,
          orderId: payment.order.id,
          eventTitle: payment.order.event.title,
          localStatus: payment.status,
          gatewayStatus,
          corrected: true,
        });
      }
    } catch (err) {
      console.error("[reconcilePayments] failed to check paid payment", payment.id, err);
    }
  }

  return { checked: payments.length, mismatches };
}

async function checkLateApprovalMismatches(
  provider: Provider,
  organizerFilter: Record<string, unknown>,
): Promise<{ checked: number; mismatches: PaymentMismatch[] }> {
  const cutoff = new Date(Date.now() - LATE_APPROVAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const payments = await db.payment.findMany({
    where: {
      status: { in: ["EXPIRED", "CANCELLED"] },
      providerPaymentId: { not: null },
      updatedAt: { gte: cutoff },
      ...organizerFilter,
    },
    select: {
      id: true,
      providerPaymentId: true,
      status: true,
      orderId: true,
      order: {
        select: {
          id: true,
          status: true,
          event: { select: { title: true } },
          registrations: { select: { id: true, ticketBatchId: true, status: true } },
        },
      },
    },
  });

  const mismatches: PaymentMismatch[] = [];
  for (const payment of payments) {
    try {
      const { status: gatewayStatus, gatewayFeeAmount, paidAt } = await provider.checkPaymentStatus(payment.providerPaymentId as string);
      if (gatewayStatus === "PAID") {
        await db.$transaction(async (tx) => {
          await applyGatewayStatus(tx, payment, payment.order, payment.order.registrations, gatewayStatus, "reconciliation", {
            gatewayFeeAmount,
            paidAt: paidAt ? new Date(paidAt) : new Date(),
          });
        });
        mismatches.push({
          paymentId: payment.id,
          orderId: payment.order.id,
          eventTitle: payment.order.event.title,
          localStatus: payment.status,
          gatewayStatus,
          corrected: true,
        });
      }
    } catch (err) {
      console.error("[reconcilePayments] failed to check late-approval payment", payment.id, err);
    }
  }

  return { checked: payments.length, mismatches };
}
