import { db } from "./db";

/**
 * Texto de divulgação dos patrocinadores ativos de um evento, pra incluir numa mensagem
 * (WhatsApp/e-mail). Ao contrário de `getSocialPromoText`, não tem efeito colateral nem
 * limite por destinatário — patrocínio é conteúdo pago do organizador, aparece sempre que
 * ativo.
 */
export async function getSponsorPromoText(eventId: string): Promise<string> {
  try {
    const sponsors = await db.eventSponsor.findMany({
      where: { eventId, active: true },
      orderBy: { createdAt: "asc" },
    });
    if (sponsors.length === 0) return "";

    return sponsors.map((s) => `${s.message} ${s.url}`).join("\n\n");
  } catch (err) {
    console.error("getSponsorPromoText failed:", err);
    return "";
  }
}
