import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAssistantInviteEmail } from "@/lib/email";

export interface CreateOrPromoteAssistantParams {
  email: string;
  name: string;
  actionKeys: string[];
  createdByUserId: string;
  invitedByName?: string;
}

export type CreateOrPromoteAssistantResult =
  | { ok: true; userId: string; isNew: boolean }
  | { ok: false; error: string; status: number };

export async function createOrPromoteAssistant(
  params: CreateOrPromoteAssistantParams,
): Promise<CreateOrPromoteAssistantResult> {
  const email = params.email.trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });

  let userId: string;
  let isNew: boolean;

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
    const updated = await db.user.update({
      where: { id: existing.id },
      data: { role: "ASSISTANT", createdByUserId: params.createdByUserId, name: params.name },
    });
    userId = updated.id;
    isNew = false;
  } else {
    // Qualquer papel que não seja "não existe" ou ATHLETE (ADMIN/ORGANIZER/ASSISTANT/
    // SUPPORT/PARTNER) é tratado como conta titular e bloqueado — não há um terceiro
    // caminho no enum UserRole, então este branch cobre tudo que sobra.
    return {
      ok: false,
      error: "Este e-mail já pertence a uma conta titular e não pode virar assistente.",
      status: 400,
    };
  }

  await db.assistantPermission.deleteMany({ where: { userId } });
  if (params.actionKeys.length > 0) {
    await db.assistantPermission.createMany({
      data: params.actionKeys.map((actionKey) => ({ userId, actionKey })),
    });
  }

  if (isNew) {
    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 1000 * 60 * 60);
    await db.verificationToken.deleteMany({ where: { identifier: email } });
    await db.verificationToken.create({ data: { identifier: email, token, expires } });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
    const resetUrl = `${baseUrl}/auth/nova-senha?token=${token}&email=${encodeURIComponent(email)}`;

    const cfg = await getSmtpConfig();
    if (isSmtpReady(cfg)) {
      try {
        await sendAssistantInviteEmail({
          to: email,
          name: params.name,
          invitedByName: params.invitedByName ?? "Um administrador",
          resetUrl,
        });
      } catch (err) {
        console.error("[createOrPromoteAssistant] invite email failed:", err);
      }
    }
  }

  return { ok: true, userId, isNew };
}
