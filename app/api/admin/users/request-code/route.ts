import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requestSensitiveActionCode } from "@/lib/security/sensitive-action-verification";
import { USER_CREATE_2FA_TARGET_ID } from "@/lib/admin/users";

/**
 * I-2 (auditoria 2026-08-31): envia o código 2FA para confirmar a CRIAÇÃO de um usuário
 * com papel elevado (`role !== "ATHLETE"`) via `POST /api/admin/users`. O caso de edição
 * usa `POST /api/admin/users/[id]/request-code`; aqui não há id ainda, então o `targetId`
 * é o sentinela `USER_CREATE_2FA_TARGET_ID`.
 */

export async function POST(_req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const result = await requestSensitiveActionCode({
    userId: session.user.id,
    actionType: "USER_SECURITY_CHANGE",
    targetId: USER_CREATE_2FA_TARGET_ID,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ verificationId: result.verificationId });
}
