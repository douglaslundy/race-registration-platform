import { generateVerificationToken } from "@/lib/auth/verification-token";
import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAssistantInviteEmail } from "@/lib/email";

export interface CreateOrPromoteAssistantParams {
  email: string;
  name: string;
  actionKeys: string[];
  createdByUserId: string;
  invitedByName?: string;
  /** Escopo das permissões: `null` = todos os eventos do responsável (comportamento histórico);
   * um id = as permissões valem só pra aquele evento. Default `null` (chamadas antigas / admin). */
  eventId?: string | null;
}

export type CreateOrPromoteAssistantResult =
  | { ok: true; userId: string; isNew: boolean; inviteResent?: boolean }
  | { ok: false; error: string; status: number };

/** Convite de acesso do assistente: gera um verificationToken de uso único (72h) e envia o e-mail
 * com o link de definição de senha. Reaproveitado na criação e no reenvio de convite. Best-effort
 * no envio — nunca lança (a criação/promoção do assistente não deve falhar se o SMTP cair). */
export async function issueAssistantInvite(params: {
  email: string;
  name: string;
  invitedByName?: string;
}): Promise<void> {
  const email = params.email.trim().toLowerCase();
  const { rawToken, tokenHash } = generateVerificationToken();
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 72); // 72h — 1h era curto demais pra convite por e-mail

  await db.verificationToken.deleteMany({ where: { identifier: email } });
  await db.verificationToken.create({ data: { identifier: email, token: tokenHash, expires } });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const resetUrl = `${baseUrl}/auth/nova-senha?token=${rawToken}&email=${encodeURIComponent(email)}`;

  const cfg = await getSmtpConfig();
  if (!isSmtpReady(cfg)) return;
  try {
    await sendAssistantInviteEmail({
      to: email,
      name: params.name,
      invitedByName: params.invitedByName ?? "Um administrador",
      resetUrl,
    });
  } catch (err) {
    console.error("[issueAssistantInvite] invite email failed:", err);
  }
}

export async function createOrPromoteAssistant(
  params: CreateOrPromoteAssistantParams,
): Promise<CreateOrPromoteAssistantResult> {
  const email = params.email.trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });

  let userId: string;
  let isNew: boolean;
  let inviteResent = false;

  if (!existing) {
    const created = await db.user.create({
      data: {
        email,
        name: params.name,
        role: "ASSISTANT",
        createdByUserId: params.createdByUserId,
        passwordHash: null,
      },
    });
    userId = created.id;
    isNew = true;
  } else if (existing.role === "ATHLETE") {
    // `active: true` é obrigatório aqui: se este e-mail já foi assistente antes, foi bloqueado
    // (active=false) e depois excluído (rebaixado para ATHLETE), a flag `active` continua `false`.
    // Sem restaurá-la, a re-promoção "funciona" mas o login segue barrado em `authorize`
    // (`!user.active`). Era exatamente o "promovido, mas cai no bloqueado/404" relatado.
    const updated = await db.user.update({
      where: { id: existing.id },
      data: {
        role: "ASSISTANT",
        createdByUserId: params.createdByUserId,
        name: params.name,
        active: true,
      },
    });
    userId = updated.id;
    isNew = false;
  } else if (existing.role === "ASSISTANT" && existing.createdByUserId === params.createdByUserId) {
    // Assistente que este mesmo criador já cadastrou — reenviar (não é erro). Atualiza nome e
    // permissões; se ainda não completou o cadastro (passwordHash null), reenvia o convite com um
    // token novo (o anterior pode ter expirado — era exatamente o problema que o usuário relatou).
    const updated = await db.user.update({
      where: { id: existing.id },
      data: { name: params.name, active: true },
    });
    userId = updated.id;
    isNew = false;
    if (existing.passwordHash === null) {
      await issueAssistantInvite({ email, name: params.name, invitedByName: params.invitedByName });
      inviteResent = true;
    }
  } else {
    // ASSISTANT de outro criador, ou conta titular (ADMIN/ORGANIZER/etc) — bloqueado.
    return {
      ok: false,
      error:
        existing.role === "ASSISTANT"
          ? "Este e-mail já é assistente de outro responsável."
          : "Este e-mail já pertence a uma conta titular e não pode virar assistente.",
      status: 400,
    };
  }

  const eventId = params.eventId ?? null;
  await db.assistantPermission.deleteMany({ where: { userId } });
  if (params.actionKeys.length > 0) {
    await db.assistantPermission.createMany({
      data: params.actionKeys.map((actionKey) => ({ userId, actionKey, eventId })),
    });
  }

  if (isNew) {
    await issueAssistantInvite({ email, name: params.name, invitedByName: params.invitedByName });
  }

  return inviteResent ? { ok: true, userId, isNew, inviteResent: true } : { ok: true, userId, isNew };
}
