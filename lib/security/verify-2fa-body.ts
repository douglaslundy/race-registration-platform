import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import {
  verifySensitiveActionCode,
  type SensitiveActionType,
} from "@/lib/security/sensitive-action-verification";

type Verify2faResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

/**
 * Consome o código 2FA presente no corpo de uma requisição de ação sensível.
 * `body.verificationId` e `body.code` precisam ser strings; senão devolve 400.
 * Em código inválido/expirado devolve 400 com `{ error, attemptsRemaining }`.
 */
export async function verify2faBody(
  session: Session,
  actionType: SensitiveActionType,
  targetId: string,
  body: { verificationId?: unknown; code?: unknown },
): Promise<Verify2faResult> {
  if (typeof body.verificationId !== "string" || typeof body.code !== "string") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Código de verificação obrigatório" },
        { status: 400 },
      ),
    };
  }
  const verification = await verifySensitiveActionCode({
    verificationId: body.verificationId,
    userId: session.user.id,
    actionType,
    targetId,
    code: body.code,
  });
  if (!verification.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: verification.error, attemptsRemaining: verification.attemptsRemaining },
        { status: 400 },
      ),
    };
  }
  return { ok: true };
}
