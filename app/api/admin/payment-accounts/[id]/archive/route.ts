import { NextRequest, NextResponse } from "next/server";
import { checkAdminOnlyApiPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { setPaymentAccountArchived } from "@/lib/payment/payment-accounts";
import { verify2faBody } from "@/lib/security/verify-2fa-body";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await checkAdminOnlyApiPermission("payment-accounts.manage");
  if (!check.allowed) return check.response;
  const { session } = check;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const archived = body.archived === true;

  const verified = await verify2faBody(session, "PAYMENT_ACCOUNT_CHANGE", id, body);
  if (!verified.ok) return verified.response;

  try {
    await setPaymentAccountArchived(id, archived);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao arquivar conta";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: archived ? "PAYMENT_ACCOUNT_ARCHIVED" : "PAYMENT_ACCOUNT_UNARCHIVED",
      entityType: "PaymentAccount",
      entityId: id,
      metadata: {},
    },
  });

  return NextResponse.json({ success: true });
}
