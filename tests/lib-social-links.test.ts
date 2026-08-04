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
    const result = buildSocialLinks({
      social_instagram: "https://instagram.com/exemplo",
      social_facebook: null,
      social_whatsapp: "https://wa.me/5511999999999",
      social_youtube: "",
      social_tiktok: undefined,
      social_x: "   ",
    });

    expect(result).toEqual([
      { key: "social_instagram", label: "Instagram", url: "https://instagram.com/exemplo" },
      { key: "social_whatsapp", label: "WhatsApp", url: "https://wa.me/5511999999999" },
    ]);
  });

  it("apara espaços em branco da URL", () => {
    const result = buildSocialLinks({ social_instagram: "  https://instagram.com/exemplo  " });
    expect(result[0].url).toBe("https://instagram.com/exemplo");
  });

  it("retorna array vazio quando nenhuma rede está preenchida", () => {
    expect(buildSocialLinks({})).toEqual([]);
  });

  it("ignora chaves desconhecidas no objeto de entrada", () => {
    const result = buildSocialLinks({ social_instagram: "https://instagram.com/x", chave_invalida: "y" });
    expect(result).toEqual([{ key: "social_instagram", label: "Instagram", url: "https://instagram.com/x" }]);
  });
});
