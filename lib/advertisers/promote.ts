import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getSmtpConfig, isSmtpReady } from "@/lib/smtp-settings";
import { sendAdvertiserPromotionEmail } from "@/lib/email";

export interface PromoteToAdvertiserInput {
  userId: string;
  companyName: string;
  contactEmail: string;
  contactPhone: string;
  promotedByUserId: string;
  promotedByName?: string;
}

export interface PromoteToAdvertiserResult {
  ok: boolean;
  error?: string;
  status?: number;
}

/**
 * Promove um usuário existente (deve estar com papel ATHLETE) a ADVERTISER, criando o
 * AdvertiserProfile correspondente na mesma transação — nunca deixa o papel mudado sem o perfil
 * (companyName/contactEmail/contactPhone são obrigatórios em qualquer fluxo que compre um plano).
 * Bloqueada quando o marketplace de anunciantes está desligado, mesma checagem do autosserviço.
 */
export async function promoteToAdvertiser(
  input: PromoteToAdvertiserInput,
): Promise<PromoteToAdvertiserResult> {
  const enabled = await getSetting("ads_marketplace_enabled");
  if (enabled !== "true") {
    return {
      ok: false,
      error: "Cadastro de anunciantes não está disponível no momento",
      status: 403,
    };
  }

  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user) {
    return { ok: false, error: "Usuário não encontrado", status: 404 };
  }
  if (user.role !== "ATHLETE") {
    return {
      ok: false,
      error: "Só é possível promover usuários com papel Atleta a Anunciante",
      status: 400,
    };
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: input.userId }, data: { role: "ADVERTISER" } });
    await tx.advertiserProfile.create({
      data: {
        userId: input.userId,
        companyName: input.companyName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: input.promotedByUserId,
        action: "USER_UPDATED",
        entityType: "User",
        entityId: input.userId,
        metadata: { role: "ADVERTISER", companyName: input.companyName },
      },
    });
  });

  const cfg = await getSmtpConfig();
  if (isSmtpReady(cfg)) {
    try {
      await sendAdvertiserPromotionEmail({
        to: user.email,
        name: user.name ?? "",
        promotedByName: input.promotedByName ?? "Um administrador",
      });
    } catch (err) {
      console.error("[promoteToAdvertiser] notification email failed:", err);
    }
  }

  return { ok: true };
}
