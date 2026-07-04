import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifyPaymentError } from "@/lib/alerts/payment-error";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;

  const registration = await db.registration.findFirst({
    where: { id },
    include: {
      order: {
        include: {
          payments: { where: { status: { in: ["EXPIRED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });

  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  const payment = registration.order.payments[0];
  if (!payment) {
    return NextResponse.json({ error: "Nenhum pagamento expirado/cancelado encontrado para esta inscrição" }, { status: 400 });
  }

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
