import { describe, expect, it } from "vitest";
import { buildSocialLinks, SOCIAL_NETWORK_KEYS } from "@/lib/social-links";

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
