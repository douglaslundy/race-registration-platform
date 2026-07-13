import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifyPaymentError, notifyOrderCancelledWithoutPayment } from "@/lib/alerts/payment-error";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;

  const registration = await db.registration.findFirst({
    where: { id, event: { organizer: { userId: session.user.id } } },
    select: {
      status: true,
      orderId: true,
      order: {
        select: {
          payments: { where: { status: { in: ["EXPIRED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });

  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  const payment = registration.order.payments[0];

  if (payment) {
    await notifyPaymentError(payment.id, { bypassDedupe: true });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PAYMENT_ERROR_NOTIFICATION_RESENT",
        entityType: "Payment",
        entityId: payment.id,
        metadata: { registrationId: id },
      },
    });
    return NextResponse.json({ success: true });
  }

  if (registration.status === "CANCELLED") {
    await notifyOrderCancelledWithoutPayment(registration.orderId, { bypassDedupe: true });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PAYMENT_ERROR_NOTIFICATION_RESENT",
        entityType: "Order",
        entityId: registration.orderId,
        metadata: { registrationId: id },
      },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Nenhum pagamento expirado/cancelado encontrado para esta inscrição" }, { status: 400 });
}
