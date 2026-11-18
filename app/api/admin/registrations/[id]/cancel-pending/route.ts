import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { cancelPendingPaymentManually } from "@/lib/payment/cancel-pending-manually";
import { cancelAbandonedOrder } from "@/lib/payment/expire-payments";
import { canCancelPendingRegistration, PENDING_CANCELLATION_THRESHOLD_HOURS } from "@/lib/registrations/pending-cancellation";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("registrations.cancel-pending-any");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;

  const registration = await db.registration.findFirst({
    where: { id },
    select: {
      id: true,
      status: true,
      createdAt: true,
      order: {
        select: {
          id: true,
          payments: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true } },
        },
      },
    },
  });

  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  if (registration.status !== "PENDING_PAYMENT") {
    return NextResponse.json({ error: "Esta inscrição não está aguardando pagamento" }, { status: 400 });
  }

  const payment = registration.order.payments[0];

  if (!canCancelPendingRegistration(registration, payment)) {
    return NextResponse.json(
      { error: `Só é possível cancelar uma inscrição pendente de pagamento após ${PENDING_CANCELLATION_THRESHOLD_HOURS} horas da inscrição` },
      { status: 400 },
    );
  }

  // Pagamento morto ou inexistente: não há nada a cancelar no gateway, só cancelar pedido e
  // inscrição e devolver a vaga.
  if (payment?.status !== "PENDING") {
    if (!(await cancelAbandonedOrder(registration.order.id))) {
      return NextResponse.json({ error: "Não foi possível cancelar — o pedido já não está pendente" }, { status: 400 });
    }
  } else {
    const result = await cancelPendingPaymentManually(payment.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
  }

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "REGISTRATION_MANUALLY_CANCELLED_BY_ADMIN",
      entityType: "Registration",
      entityId: id,
      metadata: { paymentId: payment?.id ?? null },
    },
  });

  return NextResponse.json({ success: true });
}
