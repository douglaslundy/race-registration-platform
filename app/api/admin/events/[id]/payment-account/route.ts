import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { verify2faBody } from "@/lib/security/verify-2fa-body";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("payment-accounts.manage");
  if (!check.allowed) return check.response;
  const { session } = check;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));

  const verified = await verify2faBody(session, "PAYMENT_ACCOUNT_CHANGE", id, body);
  if (!verified.ok) return verified.response;

  const paymentAccountId: string | null =
    body.paymentAccountId === null || body.paymentAccountId === undefined
      ? null
      : String(body.paymentAccountId);

  if (paymentAccountId !== null) {
    const account = await db.paymentAccount.findUnique({ where: { id: paymentAccountId } });
    if (!account || account.archivedAt !== null) {
      return NextResponse.json({ error: "Conta inválida ou arquivada" }, { status: 400 });
    }
  }

  await db.event.update({ where: { id }, data: { paymentAccountId } });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "EVENT_PAYMENT_ACCOUNT_CHANGED",
      entityType: "Event",
      entityId: id,
      metadata: { paymentAccountId },
    },
  });

  return NextResponse.json({ success: true });
}
