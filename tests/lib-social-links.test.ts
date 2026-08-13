import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSocialLinks, getSocialPromoText, SOCIAL_NETWORK_KEYS } from "@/lib/social-links";
import { db } from "@/lib/db";

const dbMock = db as any;

describe("SOCIAL_NETWORK_KEYS", () => {
  it("tem exatamente as 6 chaves esperadas, nesta ordem", () => {
    expect(SOCIAL_NETWORK_KEYS).toEqual([
      "social_instagram",
      "social_facebook",
      "social_whatsapp",
      "social_youtube",
      "social_tiktok",
      "social_x",
    ]);
  });
});

describe("buildSocialLinks", () => {
  it("retorna só as redes com valor preenchido, na ordem de SOCIAL_NETWORK_KEYS", () => {
    const result = buildSocialLinks(
      {
        social_instagram: "https://instagram.com/exemplo",
        social_facebook: null,
        social_whatsapp: "11999999999",
        social_youtube: "",
        social_tiktok: undefined,
        social_x: "   ",
      },
      "Circuito das Corridas",
    );

    expect(result).toEqual([
      { key: "social_instagram", label: "Instagram", url: "https://instagram.com/exemplo" },
      {
        key: "social_whatsapp",
        label: "WhatsApp",
        url: `https://wa.me/5511999999999?text=${encodeURIComponent("Olá, gostaria de falar com a equipe Circuito das Corridas")}`,
      },
    ]);
  });

  it("apara espaços em branco da URL", () => {
    const result = buildSocialLinks({ social_instagram: "  https://instagram.com/exemplo  " }, "Circuito das Corridas");
    expect(result[0].url).toBe("https://instagram.com/exemplo");
  });

  it("retorna array vazio quando nenhuma rede está preenchida", () => {
    expect(buildSocialLinks({}, "Circuito das Corridas")).toEqual([]);
  });

  it("ignora chaves desconhecidas no objeto de entrada", () => {
    const result = buildSocialLinks({ social_instagram: "https://instagram.com/x", chave_invalida: "y" }, "Circuito das Corridas");
    expect(result).toEqual([{ key: "social_instagram", label: "Instagram", url: "https://instagram.com/x" }]);
  });

  describe("WhatsApp", () => {
    it("monta o link wa.me a partir de só DDD + número, adicionando o DDI 55", () => {
      const result = buildSocialLinks({ social_whatsapp: "11999999999" }, "Circuito das Corridas");
      expect(result[0].url).toBe(
        `https://wa.me/5511999999999?text=${encodeURIComponent("Olá, gostaria de falar com a equipe Circuito das Corridas")}`,
      );
    });

    it("não duplica o DDI 55 quando o admin já digitou com ele", () => {
      const result = buildSocialLinks({ social_whatsapp: "5511999999999" }, "Circuito das Corridas");
      expect(result[0].url).toBe(
        `https://wa.me/5511999999999?text=${encodeURIComponent("Olá, gostaria de falar com a equipe Circuito das Corridas")}`,
      );
    });

    it("ignora formatação (parênteses, traço, espaços) no telefone", () => {
      const result = buildSocialLinks({ social_whatsapp: "(11) 99999-9999" }, "Circuito das Corridas");
      expect(result[0].url).toBe(
        `https://wa.me/5511999999999?text=${encodeURIComponent("Olá, gostaria de falar com a equipe Circuito das Corridas")}`,
      );
    });

    it("usa o nome da plataforma recebido na mensagem pré-preenchida", () => {
      const result = buildSocialLinks({ social_whatsapp: "11999999999" }, "Outra Plataforma");
      expect(result[0].url).toContain(encodeURIComponent("Olá, gostaria de falar com a equipe Outra Plataforma"));
    });
  });
});

describe("getSocialPromoText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna string vazia quando não há links ativos", async () => {
    dbMock.eventSocialLink.findMany.mockResolvedValueOnce([]);

    const result = await getSocialPromoText("event-1", "user-1");

    expect(result).toBe("");
  });

  it("inclui um link ainda dentro do limite e incrementa a contagem", async () => {
    dbMock.eventSocialLink.findMany.mockResolvedValueOnce([
      { id: "link-1", message: "Segue a gente no Instagram!", url: "https://instagram.com/corrida", maxSends: 2 },
    ]);
    const tx = {
      socialLinkSend: {
        findUnique: vi.fn().mockResolvedValueOnce({ count: 1 }),
        upsert: vi.fn().mockResolvedValueOnce({}),
      },
    };
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    const result = await getSocialPromoText("event-1", "user-1");

    expect(result).toBe("Segue a gente no Instagram! https://instagram.com/corrida");
    expect(tx.socialLinkSend.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventSocialLinkId_userId: { eventSocialLinkId: "link-1", userId: "user-1" } },
        create: { eventSocialLinkId: "link-1", userId: "user-1", count: 1 },
        update: { count: { increment: 1 } },
      }),
    );
  });

  it("pula um link que já bateu o limite, sem incrementar", async () => {
    dbMock.eventSocialLink.findMany.mockResolvedValueOnce([
      { id: "link-1", message: "Segue no Insta!", url: "https://instagram.com/corrida", maxSends: 2 },
    ]);
    const tx = {
      socialLinkSend: {
        findUnique: vi.fn().mockResolvedValueOnce({ count: 2 }),
        upsert: vi.fn(),
      },
    };
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    const result = await getSocialPromoText("event-1", "user-1");

    expect(result).toBe("");
    expect(tx.socialLinkSend.upsert).not.toHaveBeenCalled();
  });

  it("concatena vários links que ainda estão dentro do limite, um por linha", async () => {
    dbMock.eventSocialLink.findMany.mockResolvedValueOnce([
      { id: "link-1", message: "Segue no Insta!", url: "https://instagram.com/corrida", maxSends: 5 },
      { id: "link-2", message: "Bora no Strava!", url: "https://strava.com/routes/1", maxSends: 5 },
    ]);
    const tx = {
      socialLinkSend: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    dbMock.$transaction.mockImplementation(async (fn: any) => fn(tx));

    const result = await getSocialPromoText("event-1", "user-1");

    expect(result).toBe("Segue no Insta! https://instagram.com/corrida\nBora no Strava! https://strava.com/routes/1");
  });

  it("busca só links ativos do evento", async () => {
    dbMock.eventSocialLink.findMany.mockResolvedValueOnce([]);

    await getSocialPromoText("event-1", "user-1");

    expect(dbMock.eventSocialLink.findMany).toHaveBeenCalledWith({
      where: { eventId: "event-1", active: true },
    });
  });
});
