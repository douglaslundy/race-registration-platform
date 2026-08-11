import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ purchaseId: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { purchaseId } = await params;

  const purchase = await db.adPurchase.findUnique({
    where: { id: purchaseId },
    select: { id: true, status: true, payments: { select: { id: true }, where: { status: "PAID" }, take: 1 } },
  });
  if (!purchase || purchase.status !== "PENDING_APPROVAL") {
    return NextResponse.json({ error: "Solicitação não encontrada" }, { status: 404 });
  }

  const payment = purchase.payments[0];
  if (!payment) {
    return NextResponse.json({ error: "Esta solicitação não tem pagamento pago associado" }, { status: 400 });
  }

  const result = await requestSensitiveActionCode({ userId: session.user.id, actionType: "PAYMENT_REFUND", targetId: payment.id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ verificationId: result.verificationId });
}
