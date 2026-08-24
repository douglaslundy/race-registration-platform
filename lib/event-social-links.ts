import { db } from "./db";

/**
 * Texto de divulgação das redes sociais de um evento a incluir numa mensagem (WhatsApp/e-mail),
 * respeitando o limite de envios por pessoa (maxSends) de cada EventSocialLink. Cada chamada que
 * inclui um link registra/incrementa o SocialLinkSend correspondente numa transação, então esta
 * função tem efeito colateral: não é idempotente, cada chamada bem-sucedida "gasta" uma cota.
 *
 * `options.bypassQuota` (só usado por campanhas, `lib/campaigns/resolve-recipient-variables.ts`):
 * inclui o texto de todos os links ativos sempre, SEM checar nem incrementar a cota. Uma campanha é
 * um disparo deliberado e pontual decidido pelo operador — diferente dos alertas transacionais
 * (confirmação, carrinho abandonado, erro de pagamento), que repetem automaticamente ao longo do
 * ciclo de vida de um pedido e por isso precisam do limite pra não repetir a mesma divulgação
 * várias vezes pra quem já viu. Pedido explícito do usuário: "as redes sociais devem ser enviadas
 * na mensagem mesmo que o atleta já tenha atingido a cota" quando o contexto é uma campanha.
 */
export async function getSocialPromoText(
  eventId: string,
  userId: string,
  options?: { bypassQuota?: boolean },
): Promise<string> {
  try {
    const links = await db.eventSocialLink.findMany({
      where: { eventId, active: true },
    });
    if (links.length === 0) return "";

    if (options?.bypassQuota) {
      return links.map((link) => `${link.message} ${link.url}`).join("\n\n");
    }

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
