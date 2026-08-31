import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";

/**
 * Envia o código 2FA para confirmar uma alteração sensível de usuário
 * (perfil / status ativo / senha) — ver M1 da auditoria 2026-08-31.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const result = await requestSensitiveActionCode({
    userId: session.user.id,
    actionType: "USER_SECURITY_CHANGE",
    targetId: id,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ verificationId: result.verificationId });
}
