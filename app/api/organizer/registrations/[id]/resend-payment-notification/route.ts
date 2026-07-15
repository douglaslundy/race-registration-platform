import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notifyPaymentError, notifyOrderCancelledWithoutPayment } from "@/lib/alerts/payment-error";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("registrations.resend-payment-notification");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const scope = await resolveActingScope(session);

  const registration = await db.registration.findFirst({
    where: { id, event: { organizerId: scope.organizerId ?? "__none__" } },
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
