import { ALL_VARIABLES, type VariableDefinition } from "@/lib/templates/variables";

const ALWAYS_CATEGORIES = ["Atleta", "Plataforma"];
const EVENT_ONLY_CATEGORIES = ["Evento", "Organizador", "Inscrição"];

/** redes_sociais tem efeito colateral real (incrementa cota de envio por link, via
 * getSocialPromoText) — o worker de campanha (app/api/cron/send-campaign-messages/route.ts)
 * resolve essa variável só na 1ª tentativa de cada destinatário e reaproveita o valor cacheado
 * (CampaignRecipient.redesSociaisText) nas tentativas seguintes, pra nunca incrementar a cota
 * mais de uma vez pela mesma mensagem. patrocinio (getSponsorPromoText) não tem efeito colateral
 * nem limite por destinatário — resolve sempre, sem cache.
 *
 * As demais entradas abaixo são variáveis específicas de UM alerta pontual (resumo diário,
 * carrinho abandonado, inscrição por procuração) que resolveCampaignRecipientVariables
 * (lib/campaigns/resolve-recipient-variables.ts) nunca resolve — oferecê-las aqui faria o texto
 * sair com o campo em branco num envio real, já que renderTemplate substitui variável não
 * resolvida por "" silenciosamente. Se um novo alerta específico ganhar uma variável nova que
 * compartilhe categoria com uma variável de campanha, adicione o nome aqui também. */
const EXCLUDED_NAMES = new Set([
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
  "taxa_servico_bruta",
  "desconto_pix",
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
 * disponíveis; Evento/Organizador/Inscrição quando a campanha tem um evento associado (eventId
 * não-nulo) OU quando `forceEventCategories` é true — usado pelo cadastro/edição de campanha de
 * plataforma, que aceita essas variáveis no texto mas depende da guarda em
 * messageUsesEventScopedVariables (checada no agendar/disparar) pra garantir que só sejam
 * realmente enviadas quando todo destinatário tiver um registrationId (seleção manual filtrada
 * por evento). Única fonte de verdade: tanto a validação no backend quanto o catálogo mostrado na
 * UI consultam esta função. */
export function getAllowedCampaignVariables(
  eventId: string | null,
  forceEventCategories = false,
): VariableDefinition[] {
  const categories = new Set(
    eventId !== null || forceEventCategories ? [...ALWAYS_CATEGORIES, ...EVENT_ONLY_CATEGORIES] : ALWAYS_CATEGORIES,
  );
  return ALL_VARIABLES.filter((v) => {
    if (!categories.has(v.category) || EXCLUDED_NAMES.has(v.name)) return false;
    // categoria_inscricao só é resolvida quando há uma inscrição associada (modo evento, ou
    // seleção manual de plataforma filtrada por evento — ver resolveCampaignRecipientVariables).
    if (v.name === "categoria_inscricao" && eventId === null && !forceEventCategories) return false;
    return true;
  });
}

export function getAllowedCampaignVariableNames(eventId: string | null, forceEventCategories = false): string[] {
  return getAllowedCampaignVariables(eventId, forceEventCategories).map((v) => v.name);
}

/** Detecta se um texto de mensagem usa alguma variável de categoria Evento/Organizador/Inscrição —
 * usado pela guarda de agendar/disparar: campanhas de plataforma só podem realmente enviar essas
 * variáveis se TODOS os destinatários tiverem um registrationId (ver seleção manual filtrada por
 * evento em lib/campaigns/recipients.ts). */
export function messageUsesEventScopedVariables(messageBody: string): boolean {
  const eventScopedNames = new Set(
    ALL_VARIABLES.filter((v) => EVENT_ONLY_CATEGORIES.includes(v.category)).map((v) => v.name),
  );
  const found = [...messageBody.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  return found.some((name) => eventScopedNames.has(name));
}
