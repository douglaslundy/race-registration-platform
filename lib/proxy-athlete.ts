import { randomUUID, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendProxyRegistrationInviteEmail } from "@/lib/email";

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

/** Gera um token de verificação (mesmo padrão de createOrPromoteAssistant) e dispara o e-mail de
 * convite pro atleta inscrito por procuração definir a senha e acessar a própria conta.
 * Best-effort: nunca lança — chamado fire-and-forget pela rota de checkout. */
export async function sendProxyRegistrationInvite(params: {
  name: string;
  email: string;
  invitedByName: string;
}): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 1000 * 60 * 60);
  await db.verificationToken.deleteMany({ where: { identifier: params.email } });
  await db.verificationToken.create({ data: { identifier: params.email, token, expires } });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const resetUrl = `${baseUrl}/auth/nova-senha?token=${token}&email=${encodeURIComponent(params.email)}`;

  const cfg = await getSmtpConfig();
  if (!isSmtpReady(cfg)) return;

  try {
    await sendProxyRegistrationInviteEmail({
      to: params.email,
      name: params.name,
      invitedByName: params.invitedByName,
      resetUrl,
    });
  } catch (err) {
    console.error("[sendProxyRegistrationInvite] invite email failed:", err);
  }
}
