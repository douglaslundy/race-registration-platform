import { db } from "./db";

/**
 * Texto de divulgação das redes sociais de um evento a incluir numa mensagem (WhatsApp/e-mail),
 * respeitando o limite de envios por pessoa (maxSends) de cada EventSocialLink. Cada chamada que
 * inclui um link registra/incrementa o SocialLinkSend correspondente numa transação, então esta
 * função tem efeito colateral: não é idempotente, cada chamada bem-sucedida "gasta" uma cota.
 */
export async function getSocialPromoText(eventId: string, userId: string): Promise<string> {
  try {
    const links = await db.eventSocialLink.findMany({
      where: { eventId, active: true },
    });
    if (links.length === 0) return "";

    const parts: string[] = [];
    for (const link of links) {
      const included = await claimSocialLinkSend(link.id, userId, link.maxSends);
      if (included) parts.push(`${link.message} ${link.url}`);
    }
    return parts.join("\n\n");
  } catch (err) {
    console.error("getSocialPromoText failed:", err);
    return "";
  }
}

async function claimSocialLinkSend(eventSocialLinkId: string, userId: string, maxSends: number): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const existing = await tx.socialLinkSend.findUnique({
      where: { eventSocialLinkId_userId: { eventSocialLinkId, userId } },
    });
    const currentCount = existing?.count ?? 0;
    if (currentCount >= maxSends) return false;

    await tx.socialLinkSend.upsert({
      where: { eventSocialLinkId_userId: { eventSocialLinkId, userId } },
      create: { eventSocialLinkId, userId, count: 1 },
      update: { count: { increment: 1 } },
    });
    return true;
  });
}
