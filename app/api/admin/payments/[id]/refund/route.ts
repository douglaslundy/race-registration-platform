import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { refundPayment } from "@/lib/payment/refund-service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("payments.refund-any");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : undefined;

  try {
    const result = await refundPayment({ paymentId: id, initiatedByUserId: session.user.id, reason });
    return NextResponse.json({ success: true, alreadySynced: result.alreadySynced });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao estornar pagamento";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
