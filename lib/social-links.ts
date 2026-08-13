import { db } from "./db";

export interface SocialNetworkDefinition {
  key: string;
  label: string;
}

export const SOCIAL_NETWORKS: SocialNetworkDefinition[] = [
  { key: "social_instagram", label: "Instagram" },
  { key: "social_facebook", label: "Facebook" },
  { key: "social_whatsapp", label: "WhatsApp" },
  { key: "social_youtube", label: "YouTube" },
  { key: "social_tiktok", label: "TikTok" },
  { key: "social_x", label: "X" },
];

export const SOCIAL_NETWORK_KEYS: string[] = SOCIAL_NETWORKS.map((n) => n.key);

export interface SocialLink {
  key: string;
  label: string;
  url: string;
}

/**
 * O admin cadastra só DDD + número (sem +55) pro WhatsApp — mesma convenção já usada em
 * EventDailySummaryRecipientsManager. Não importa lib/whatsapp.ts (infra de envio) aqui só pra
 * reaproveitar a normalização — duplicar essas poucas linhas mantém este arquivo livre de
 * dependência com o envio de mensagens, sendo usado no caminho de renderização pública.
 */
function normalizePhoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }
  return `55${digits}`;
}

function buildWhatsAppLink(phone: string, appName: string): string {
  const message = `Olá, gostaria de falar com a equipe ${appName}`;
  return `https://wa.me/${normalizePhoneDigits(phone)}?text=${encodeURIComponent(message)}`;
}

/** Retorna só as redes com valor preenchido (não vazio/whitespace), na ordem de SOCIAL_NETWORKS. */
export function buildSocialLinks(values: Record<string, string | null | undefined>, appName: string): SocialLink[] {
  const result: SocialLink[] = [];
  for (const network of SOCIAL_NETWORKS) {
    const raw = values[network.key];
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    const url = network.key === "social_whatsapp" ? buildWhatsAppLink(trimmed, appName) : trimmed;
    result.push({ key: network.key, label: network.label, url });
  }
  return result;
}

/**
 * Texto de divulgação das redes sociais de um evento a incluir numa mensagem (WhatsApp/e-mail),
 * respeitando o limite de envios por pessoa (maxSends) de cada EventSocialLink. Cada chamada que
 * inclui um link registra/incrementa o SocialLinkSend correspondente numa transação, então esta
 * função tem efeito colateral: não é idempotente, cada chamada bem-sucedida "gasta" uma cota.
 */
export async function getSocialPromoText(eventId: string, userId: string): Promise<string> {
  const links = await db.eventSocialLink.findMany({
    where: { eventId, active: true },
  });
  if (links.length === 0) return "";

  const parts: string[] = [];
  for (const link of links) {
    const included = await claimSocialLinkSend(link.id, userId, link.maxSends);
    if (included) parts.push(`${link.message} ${link.url}`);
  }
  return parts.join("\n");
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
