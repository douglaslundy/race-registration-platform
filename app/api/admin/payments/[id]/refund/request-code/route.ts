import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("payments.refund-any");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;

  const payment = await db.payment.findUnique({ where: { id }, select: { status: true } });
  if (!payment || payment.status !== "PAID") {
    return NextResponse.json({ error: "Só é possível estornar pagamentos com status Pago" }, { status: 400 });
  }

  const result = await requestSensitiveActionCode({ userId: session.user.id, actionType: "PAYMENT_REFUND", targetId: id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ verificationId: result.verificationId });
}
