import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPaymentProviderSetting } from "@/lib/payment-settings";
import { checkMPPaymentStatus } from "@/lib/payment/check-mp-status";
import { applyGatewayStatus } from "@/lib/payment/sync-payment-status";
import { notifyOrderConfirmed } from "@/lib/notifications";
import { notifyPaymentError } from "@/lib/alerts/payment-error";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const order = await db.order.findFirst({
    where: { id, buyerUserId: session.user.id },
    select: {
      id: true,
      status: true,
      totalAmount: true,
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, providerPaymentId: true, status: true },
      },
      registrations: { select: { id: true, ticketBatchId: true, status: true } },
    },
  });

  if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });

  // Live check with Mercado Pago when order is still pending
  if (order.status === "PENDING") {
    const payment = order.payments[0];
    if (payment?.providerPaymentId) {
      const providerSetting = await getPaymentProviderSetting();
      if (providerSetting === "mercadopago") {
        const mpStatus = await checkMPPaymentStatus(payment.providerPaymentId);
        if (mpStatus === "PAID" && payment.status !== "PAID") {
          const result = await db.$transaction((tx) =>
            applyGatewayStatus(tx, payment, order, order.registrations, "PAID", "status_poll", { paidAt: new Date() }),
          );
          if (result.changed) void notifyOrderConfirmed(order.id);
          return NextResponse.json({ status: "PAID", totalAmount: order.totalAmount });
        }
        if (mpStatus === "CANCELLED" && payment.status !== "CANCELLED") {
          const result = await db.$transaction((tx) =>
            applyGatewayStatus(tx, payment, order, order.registrations, "CANCELLED", "status_poll"),
          );
          if (result.changed) void notifyPaymentError(payment.id);
          return NextResponse.json({ status: "CANCELLED", totalAmount: order.totalAmount });
        }
      }
    }
  }

  return NextResponse.json({ status: order.status, totalAmount: order.totalAmount });
}
