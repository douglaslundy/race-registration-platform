import { ALL_VARIABLES, type VariableDefinition } from "@/lib/templates/variables";

const ALWAYS_CATEGORIES = ["Atleta", "Plataforma"];
const EVENT_ONLY_CATEGORIES = ["Evento", "Organizador", "Inscrição"];

/** patrocinio/redes_sociais têm efeito colateral (incrementam cota de envio por link/patrocinador)
 * e foram desenhadas pra um envio por inscrição (um alerta de confirmação por vez) — nunca fizeram
 * sentido pra uma campanha que renderiza o mesmo texto pra centenas/milhares de destinatários. */
const EXCLUDED_NAMES = new Set(["patrocinio", "redes_sociais"]);

/** Decide quais categorias de variável uma campanha pode usar: Atleta/Plataforma sempre estão
 * disponíveis; Evento/Organizador/Inscrição só quando a campanha tem um evento associado
 * (eventId não-nulo) — não fazem sentido numa campanha de plataforma inteira, que não tem um
 * único evento/inscrição pra resolver essas variáveis. Única fonte de verdade: tanto a validação
 * no backend quanto o catálogo mostrado na UI consultam esta função. */
export function getAllowedCampaignVariables(eventId: string | null): VariableDefinition[] {
  const categories = new Set(
    eventId !== null ? [...ALWAYS_CATEGORIES, ...EVENT_ONLY_CATEGORIES] : ALWAYS_CATEGORIES,
  );
  return ALL_VARIABLES.filter((v) => categories.has(v.category) && !EXCLUDED_NAMES.has(v.name));
}

export function getAllowedCampaignVariableNames(eventId: string | null): string[] {
  return getAllowedCampaignVariables(eventId).map((v) => v.name);
}
