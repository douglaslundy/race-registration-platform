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

  if (!("paymentAccountId" in body)) {
    return NextResponse.json(
      { error: "paymentAccountId é obrigatório (use null para remover o override)" },
      { status: 400 },
    );
  }

  // Só um `null` explícito limpa o override; qualquer outro valor vira string.
  const paymentAccountId: string | null =
    body.paymentAccountId === null ? null : String(body.paymentAccountId);

  if (paymentAccountId !== null) {
    const account = await db.paymentAccount.findUnique({ where: { id: paymentAccountId } });
    if (!account || account.archivedAt !== null) {
      return NextResponse.json({ error: "Conta inválida ou arquivada" }, { status: 400 });
    }
  }

  const event = await db.event.findUnique({ where: { id }, select: { id: true } });
  if (!event) {
    return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
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
