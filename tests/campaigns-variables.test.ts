import { describe, expect, it } from "vitest";
import { getAllowedCampaignVariables, getAllowedCampaignVariableNames } from "@/lib/campaigns/variables";

describe("getAllowedCampaignVariables", () => {
  it("modo plataforma (eventId null) só inclui categorias Atleta e Plataforma", () => {
    const variables = getAllowedCampaignVariables(null);
    const categories = new Set(variables.map((v) => v.category));
    expect(categories).toEqual(new Set(["Atleta", "Plataforma"]));
  });

  it("modo evento (eventId definido) inclui Atleta, Plataforma, Evento, Organizador e Inscrição", () => {
    const variables = getAllowedCampaignVariables("event-1");
    const categories = new Set(variables.map((v) => v.category));
    expect(categories).toEqual(new Set(["Atleta", "Plataforma", "Evento", "Organizador", "Inscrição"]));
  });

  it("nunca inclui categorias fora dessas 5, em nenhum dos dois modos", () => {
    const disallowed = ["Cancelamento", "Pagamento", "Vagas", "Anunciante", "Conciliação"];
    const platformCategories = new Set(getAllowedCampaignVariables(null).map((v) => v.category));
    const eventCategories = new Set(getAllowedCampaignVariables("event-1").map((v) => v.category));
    for (const cat of disallowed) {
      expect(platformCategories.has(cat)).toBe(false);
      expect(eventCategories.has(cat)).toBe(false);
    }
  });

  it("getAllowedCampaignVariableNames retorna só os nomes", () => {
    const names = getAllowedCampaignVariableNames(null);
    expect(names).toContain("nome_atleta");
    expect(names).toContain("nome_plataforma");
    expect(names).not.toContain("nome_evento");
  });

  it("nome_evento aparece quando eventId é fornecido", () => {
    const names = getAllowedCampaignVariableNames("event-1");
    expect(names).toContain("nome_evento");
  });

  it("inclui patrocinio/redes_sociais em modo evento (patrocinio sem efeito colateral, redes_sociais cacheado pelo worker)", () => {
    const names = getAllowedCampaignVariableNames("event-1");
    expect(names).toContain("patrocinio");
    expect(names).toContain("redes_sociais");
  });

  it("nunca inclui patrocinio/redes_sociais em modo plataforma (categoria Evento não se aplica)", () => {
    const names = getAllowedCampaignVariableNames(null);
    expect(names).not.toContain("patrocinio");
    expect(names).not.toContain("redes_sociais");
  });
});
