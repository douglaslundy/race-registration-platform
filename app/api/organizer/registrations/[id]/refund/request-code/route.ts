import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkApiPermission("payments.refund");
  if (!check.allowed) return check.response;
  const { session } = check;

  let organizerUserId = session.user.id;
  if (session.user.role === "ASSISTANT") {
    const assistant = await db.user.findUnique({
      where: { id: session.user.id },
      select: { createdByUserId: true },
    });
    organizerUserId = assistant?.createdByUserId ?? "__none__";
  }

  const { id } = await params;

  const registration = await db.registration.findFirst({
    where: { id, event: { organizer: { userId: organizerUserId } } },
    include: {
      order: {
        include: { payments: { where: { status: "PAID" }, orderBy: { paidAt: "desc" }, take: 1 } },
      },
    },
  });

  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  const payment = registration.order.payments[0];
  if (!payment) {
    return NextResponse.json({ error: "Nenhum pagamento pago encontrado para esta inscrição" }, { status: 400 });
  }

  const result = await requestSensitiveActionCode({ userId: session.user.id, actionType: "PAYMENT_REFUND", targetId: payment.id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ verificationId: result.verificationId });
}
