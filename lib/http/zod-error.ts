import { NextResponse } from "next/server";
import type { ZodError } from "zod";

/**
 * L5 (auditoria 2026-08-31): várias rotas devolviam `parsed.error.flatten()` — expõe a
 * estrutura interna do schema ao cliente sem ganho real. Padroniza numa mensagem fixa.
 * O detalhe do erro (quando útil pra debug) fica só no log do servidor.
 */
export function zodErrorResponse(error?: ZodError): NextResponse {
  if (error && process.env.NODE_ENV !== "production") {
    console.warn("[validation] payload inválido:", error.flatten());
  }
  return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
}
