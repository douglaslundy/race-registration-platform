import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { refundPayment } from "@/lib/payment/refund-service";
import { verifySensitiveActionCode } from "@/lib/security/sensitive-action-verification";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
        include: {
          payments: { where: { status: "PAID" }, orderBy: { paidAt: "desc" }, take: 1 },
        },
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

  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : undefined;

  const { verificationId, code } = body;
  if (typeof verificationId !== "string" || typeof code !== "string") {
    return NextResponse.json({ error: "Código de verificação obrigatório" }, { status: 400 });
  }
  const verification = await verifySensitiveActionCode({
    verificationId,
    userId: session.user.id,
    actionType: "PAYMENT_REFUND",
    targetId: payment.id,
    code,
  });
  if (!verification.ok) {
    return NextResponse.json({ error: verification.error, attemptsRemaining: verification.attemptsRemaining }, { status: 400 });
  }

  try {
    const result = await refundPayment({ paymentId: payment.id, initiatedByUserId: session.user.id, reason });
    return NextResponse.json({ success: true, alreadySynced: result.alreadySynced });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao estornar pagamento";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
