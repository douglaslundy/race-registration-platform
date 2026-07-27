export interface EventPromptContext {
  kind: "event";
  field: "metaTitle" | "metaDescription";
  title: string;
  description?: string | null;
  city: string;
  state: string;
  modality: string;
  startAt: Date;
  brandContext?: string | null;
}

export interface SitePromptContext {
  kind: "site";
  field: "metaTitle" | "metaDescription";
  appName: string;
  brandContext?: string | null;
}

export type SeoPromptContext = EventPromptContext | SitePromptContext;

const MODALITY_LABEL: Record<string, string> = {
  ROAD_RACE: "corrida de rua",
  TRAIL_RUN: "trail run",
  MTB: "mountain bike",
  CYCLING: "ciclismo",
  WALK: "caminhada",
  TRIATHLON: "triathlon",
  OTHER: "evento esportivo",
};

export function buildSeoPrompt(ctx: SeoPromptContext): string {
  const limit = ctx.field === "metaTitle" ? 60 : 155;
  const fieldLabel = ctx.field === "metaTitle" ? "título" : "descrição";
  const rules = [
    "Escreva em português do Brasil.",
    "Gere só o texto final, sem aspas, sem explicação, sem markdown.",
    `Máximo de ${limit} caracteres.`,
    "Tom convidativo, adequado pra um resultado de busca do Google.",
  ];

  if (ctx.kind === "event") {
    const modalityLabel = MODALITY_LABEL[ctx.modality] ?? "evento esportivo";
    const dateLabel = ctx.startAt.toLocaleDateString("pt-BR");
    return [
      `Gere um(a) ${fieldLabel} de SEO para a página de um evento esportivo de inscrição online.`,
      `Evento: "${ctx.title}", modalidade ${modalityLabel}, em ${ctx.city}/${ctx.state}, no dia ${dateLabel}.`,
      ctx.description ? `Descrição do evento: ${ctx.description.slice(0, 500)}` : "",
      ctx.brandContext ? `Contexto do site: ${ctx.brandContext}` : "",
      `Inclua palavras-chave relevantes (ex.: inscrição, ${modalityLabel}, ${ctx.city}/${ctx.state}) sem forçar.`,
      ...rules,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `Gere um(a) ${fieldLabel} de SEO para a página inicial de uma plataforma de inscrição em corridas e eventos esportivos chamada "${ctx.appName}".`,
    ctx.brandContext ? `Contexto do site: ${ctx.brandContext}` : "",
    ...rules,
  ]
    .filter(Boolean)
    .join("\n");
}

export function truncateSeoText(text: string, field: "metaTitle" | "metaDescription"): string {
  const limit = field === "metaTitle" ? 70 : 160;
  return text.trim().slice(0, limit);
}
