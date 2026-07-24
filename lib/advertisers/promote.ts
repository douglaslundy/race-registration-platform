import { db } from "@/lib/db";

export interface PromoteToAdvertiserInput {
  userId: string;
  companyName: string;
  contactEmail: string;
  contactPhone: string;
  promotedByUserId: string;
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
 */
export async function promoteToAdvertiser(
  input: PromoteToAdvertiserInput,
): Promise<PromoteToAdvertiserResult> {
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { id: true, role: true },
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

  return { ok: true };
}
