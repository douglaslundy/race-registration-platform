import { createHash, randomBytes } from "crypto";

/**
 * L1 (auditoria 2026-08-31): os tokens de definição/recuperação de senha eram gravados em
 * claro em `VerificationToken.token`. Agora guardamos só o `sha256(token)` — quem enxerga o
 * banco (dump, log, SQLi noutro ponto) não consegue mais tomar a conta na janela de validade.
 * O token que vai no link do e-mail continua sendo o valor bruto.
 */
export function hashVerificationToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** Gera um par { rawToken (vai no link), tokenHash (vai no banco) }. */
export function generateVerificationToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString("hex");
  return { rawToken, tokenHash: hashVerificationToken(rawToken) };
}
