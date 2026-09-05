import { normalizeCpf } from "@/lib/cpf";

/**
 * Filtro / ordenação / resumo da aba "Todos os inscritos" da entrega de kits — puro, sem I/O.
 * Compartilhado entre o componente cliente (`KitDeliveryFullList`) e a rota de PDF
 * (`/api/events/[id]/kit-deliveries/list/pdf`) pra que os dois apliquem exatamente os mesmos
 * critérios sobre a mesma lista (`listKitDeliveries`).
 */

export type KitDeliveryStatusFilter = "all" | "delivered" | "pending";
export type KitDeliverySortOrder = "delivered-first" | "pending-first";

/** Subconjunto de `KitDeliveryListItem` de que o filtro/ordenação precisa. O componente usa
 * `deliveredAt: string` e a lib usa `Date`; nada aqui toca nesse campo, então fica genérico. */
export interface KitDeliveryFilterableItem {
  participantName: string;
  participantCpf: string | null;
  delivered: boolean;
  deliveredByName: string | null;
}

export interface KitDeliveryListFilters {
  status: KitDeliveryStatusFilter;
  /** Nome exato de quem entregou (`deliveredByName`); `null` = todos os assistentes. */
  assistant: string | null;
  q: string;
}

export interface KitDeliveryListParams extends KitDeliveryListFilters {
  sort: KitDeliverySortOrder;
}

const STATUS_VALUES: KitDeliveryStatusFilter[] = ["all", "delivered", "pending"];
const SORT_VALUES: KitDeliverySortOrder[] = ["delivered-first", "pending-first"];

export function filterKitDeliveryItems<T extends KitDeliveryFilterableItem>(
  items: T[],
  { status, assistant, q }: KitDeliveryListFilters,
): T[] {
  const term = q.trim().toLowerCase();
  const digits = normalizeCpf(q);
  return items.filter((i) => {
    if (status === "delivered" && !i.delivered) return false;
    if (status === "pending" && i.delivered) return false;
    if (assistant && i.deliveredByName !== assistant) return false;
    if (!term && digits.length === 0) return true;
    const nameHit = term.length > 0 && i.participantName.toLowerCase().includes(term);
    const cpfHit = digits.length > 0 && (i.participantCpf ?? "").includes(digits);
    return nameHit || cpfHit;
  });
}

export function sortKitDeliveryItems<T extends KitDeliveryFilterableItem>(
  items: T[],
  order: KitDeliverySortOrder,
): T[] {
  const rank = (delivered: boolean) =>
    order === "delivered-first" ? (delivered ? 0 : 1) : delivered ? 1 : 0;
  return [...items].sort((a, b) => {
    const byGroup = rank(a.delivered) - rank(b.delivered);
    return byGroup !== 0 ? byGroup : a.participantName.localeCompare(b.participantName, "pt-BR");
  });
}

/** Nomes distintos de quem já entregou algum kit, em ordem alfabética — alimenta o seletor de
 * assistente. */
export function kitDeliveryAssistantNames(items: KitDeliveryFilterableItem[]): string[] {
  const names = new Set<string>();
  for (const i of items) {
    if (i.delivered && i.deliveredByName) names.add(i.deliveredByName);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function parseKitDeliveryListParams(searchParams: URLSearchParams): KitDeliveryListParams {
  const status = searchParams.get("status");
  const sort = searchParams.get("sort");
  const assistant = searchParams.get("assistant");
  return {
    status: STATUS_VALUES.includes(status as KitDeliveryStatusFilter)
      ? (status as KitDeliveryStatusFilter)
      : "all",
    sort: SORT_VALUES.includes(sort as KitDeliverySortOrder) ? (sort as KitDeliverySortOrder) : "delivered-first",
    assistant: assistant && assistant.trim() ? assistant : null,
    q: searchParams.get("q")?.trim() ?? "",
  };
}

const STATUS_LABEL: Record<KitDeliveryStatusFilter, string> = {
  all: "Todos os inscritos",
  delivered: "Entregues",
  pending: "Pendentes",
};

const SORT_LABEL: Record<KitDeliverySortOrder, string> = {
  "delivered-first": "entregues primeiro",
  "pending-first": "pendentes primeiro",
};

/** Linha legível com os filtros aplicados — vai no cabeçalho do PDF. */
export function summarizeKitDeliveryFilters(params: KitDeliveryListParams): string {
  const parts = [STATUS_LABEL[params.status]];
  if (params.assistant) parts.push(`assistente: ${params.assistant}`);
  if (params.q) parts.push(`busca: "${params.q}"`);
  parts.push(SORT_LABEL[params.sort]);
  return parts.join(" · ");
}
