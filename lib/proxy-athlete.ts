import { randomUUID } from "crypto";

const PLACEHOLDER_EMAIL_DOMAIN = "sememail.internal";

/** Gera um e-mail sintético único, nunca roteável, pra satisfazer o @unique de User.email quando
 * o comprador não informa o e-mail do atleta numa inscrição por procuração. Nunca deve ser
 * exibido em nenhuma tela nem usado como destinatário de envio real — checar com
 * isPlaceholderEmail() antes de mandar qualquer coisa pro e-mail de um atleta. */
export function generatePlaceholderEmail(): string {
  return `${randomUUID()}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

export function isPlaceholderEmail(email: string): boolean {
  return email.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}
