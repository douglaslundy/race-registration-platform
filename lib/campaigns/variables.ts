import { ALL_VARIABLES, type VariableDefinition } from "@/lib/templates/variables";

const ALWAYS_CATEGORIES = ["Atleta", "Plataforma"];
const EVENT_ONLY_CATEGORIES = ["Evento", "Organizador", "Inscrição"];

/** patrocinio/redes_sociais têm efeito colateral (incrementam cota de envio por link/patrocinador)
 * e foram desenhadas pra um envio por inscrição (um alerta de confirmação por vez) — nunca fizeram
 * sentido pra uma campanha que renderiza o mesmo texto pra centenas/milhares de destinatários.
 *
 * As demais entradas abaixo são variáveis específicas de UM alerta pontual (resumo diário,
 * carrinho abandonado, inscrição por procuração) que resolveCampaignRecipientVariables
 * (lib/campaigns/resolve-recipient-variables.ts) nunca resolve — oferecê-las aqui faria o texto
 * sair com o campo em branco num envio real, já que renderTemplate substitui variável não
 * resolvida por "" silenciosamente. Se um novo alerta específico ganhar uma variável nova que
 * compartilhe categoria com uma variável de campanha, adicione o nome aqui também. */
const EXCLUDED_NAMES = new Set([
  "patrocinio",
  "redes_sociais",
  // Resumo diário (Plataforma)
  "data_resumo",
  "papel_destinatario",
  "total_inscricoes_pagas",
  "receita_periodo",
  "novos_usuarios",
  "eventos_criados",
  "cupons_usados",
  "novos_organizadores",
  "taxa_plataforma",
  "taxa_servico",
  "repasses_gerados",
  "valor_repasses",
  "cancelamentos_estornos",
  "cancelamentos_solicitados",
  "lotes_esgotados",
  // Resumo diário por evento (Evento)
  "inscricoes_pagas",
  "receita_evento",
  "vagas_restantes",
  // Carrinho abandonado / inscrição por procuração (Inscrição)
  "link_finalizar_pagamento",
  "nome_comprador",
]);

/** Decide quais categorias de variável uma campanha pode usar: Atleta/Plataforma sempre estão
 * disponíveis; Evento/Organizador/Inscrição só quando a campanha tem um evento associado
 * (eventId não-nulo) — não fazem sentido numa campanha de plataforma inteira, que não tem um
 * único evento/inscrição pra resolver essas variáveis. Única fonte de verdade: tanto a validação
 * no backend quanto o catálogo mostrado na UI consultam esta função. */
export function getAllowedCampaignVariables(eventId: string | null): VariableDefinition[] {
  const categories = new Set(
    eventId !== null ? [...ALWAYS_CATEGORIES, ...EVENT_ONLY_CATEGORIES] : ALWAYS_CATEGORIES,
  );
  return ALL_VARIABLES.filter((v) => {
    if (!categories.has(v.category) || EXCLUDED_NAMES.has(v.name)) return false;
    // categoria_inscricao só é resolvida quando há uma inscrição associada (modo evento) — ver
    // resolveCampaignRecipientVariables.
    if (v.name === "categoria_inscricao" && eventId === null) return false;
    return true;
  });
}

export function getAllowedCampaignVariableNames(eventId: string | null): string[] {
  return getAllowedCampaignVariables(eventId).map((v) => v.name);
}
