import type { Session } from "next-auth";
import {
  resolveActingScope,
  assistantHasAnyPermission,
  assistantPermittedEventIds,
} from "./rbac";

/**
 * Controle de acesso da área do organizador (`/organizador/*`) por permissão.
 *
 * O `requireOrganizer()` do layout só confirma que a sessão é staff de ALGUM organizador — não
 * diz *o que* um ASSISTANT pode ver. Sem isto, um assistente confinado a "entrega de kits" abre
 * a área e enxerga (e navega) tudo: relatório financeiro, lista de inscritos, receita por evento.
 * As rotas de API já barram as *ações* (checkApiPermission), mas várias páginas leem o banco
 * direto — então a página em si precisa ser barrada.
 *
 * ADMIN / ORGANIZER titulares e ASSISTANT de admin (`actingAsAdmin`) passam sempre.
 * ASSISTANT de organizador passa só se tiver a AssistantPermission da rota (global ou do evento).
 */

export type OrganizerNavItem = {
  href: string;
  label: string;
  /** actionKeys que liberam o item. `[]` = só titular. `["*"]` = dashboard (assistente é redirecionado). */
  actionKeys: string[];
};

export const ORGANIZER_NAV: OrganizerNavItem[] = [
  { href: "/organizador", label: "Dashboard", actionKeys: ["*"] },
  { href: "/organizador#meus-eventos", label: "Meus Eventos", actionKeys: ["events.view"] },
  { href: "/organizador/relatorio", label: "Relatório", actionKeys: ["reports.export"] },
  { href: "/organizador/entrega-kits", label: "Entrega de kits", actionKeys: ["kits.view", "kits.deliver"] },
  { href: "/organizador/eventos/novo", label: "Novo Evento", actionKeys: ["events.create"] },
  { href: "/organizador/perfil", label: "Meus Dados", actionKeys: [] },
  { href: "/organizador/conciliacao", label: "Conciliação", actionKeys: ["payments.reconciliation"] },
  { href: "/organizador/pedidos-vencidos", label: "Pedidos vencidos", actionKeys: ["registrations.expire-payments"] },
  { href: "/organizador/carrinhos-abandonados", label: "Carrinhos abandonados", actionKeys: ["abandoned-carts.notify"] },
  { href: "/organizador/mensagens", label: "Mensagens", actionKeys: ["messages.view"] },
  { href: "/organizador/reembolsos-pendentes", label: "Cancelamentos pendentes", actionKeys: ["registrations.cancellation-decision", "registrations.manual-confirm", "payments.refund", "payments.manual-resolve"] },
  { href: "/organizador/assistentes", label: "Assistentes", actionKeys: [] },
];

/** Toda actionKey de assistente que é escopada por evento (usada pro hub `/organizador/eventos/[id]`). */
export const EVENT_SCOPED_ACTIONS = [
  "events.view", "events.edit", "events.delete", "events.archive", "events.duplicate",
  "batches.create", "batches.edit", "batches.delete",
  "categories.create", "categories.edit", "categories.delete",
  "routes.create", "routes.edit", "routes.delete",
  "registrations.view", "registrations.cancellation-decision", "registrations.manual-confirm",
  "registrations.cancel-pending", "registrations.cancel-confirmed", "registrations.edit-athlete",
  "registrations.resend-confirmation-email", "registrations.resend-payment-notification",
  "coupons.view", "coupons.create", "coupons.edit", "coupons.delete", "coupons.report-export",
  "social-links.view", "social-links.create", "social-links.edit", "social-links.delete",
  "sponsors.view", "sponsors.create", "sponsors.edit", "sponsors.delete",
  "campaigns.view", "campaigns.create", "campaigns.edit", "campaigns.cancel",
  "kits.view", "kits.deliver",
  "payments.refund", "results.import", "results.publish",
];

type RouteRule =
  | { re: RegExp; keys: string[]; scoped?: boolean }
  | { re: RegExp; titularOnly: true }
  | { re: RegExp; anyStaff: true };

/** Ordenado — primeira regra que casa vale. Rotas mais específicas antes das genéricas. */
const ROUTE_RULES: RouteRule[] = [
  { re: /^\/organizador\/?$/, anyStaff: true },
  { re: /^\/organizador\/perfil(\/|$)/, titularOnly: true },
  { re: /^\/organizador\/assistentes(\/|$)/, titularOnly: true },
  { re: /^\/organizador\/relatorio(\/|$)/, keys: ["reports.export"] },
  { re: /^\/organizador\/entrega-kits(\/|$)/, keys: ["kits.view", "kits.deliver"] },
  { re: /^\/organizador\/conciliacao(\/|$)/, keys: ["payments.reconciliation"] },
  { re: /^\/organizador\/pedidos-vencidos(\/|$)/, keys: ["registrations.expire-payments"] },
  { re: /^\/organizador\/carrinhos-abandonados(\/|$)/, keys: ["abandoned-carts.notify"] },
  { re: /^\/organizador\/mensagens(\/|$)/, keys: ["messages.view"] },
  { re: /^\/organizador\/reembolsos-pendentes(\/|$)/, keys: ["registrations.cancellation-decision", "registrations.manual-confirm", "payments.refund", "payments.manual-resolve"] },
  { re: /^\/organizador\/eventos\/novo(\/|$)/, keys: ["events.create"] },
  { re: /^\/organizador\/eventos\/([^/]+)\/editar(\/|$)/, keys: ["events.edit"], scoped: true },
  { re: /^\/organizador\/eventos\/([^/]+)\/inscritos(\/|$)/, keys: ["registrations.view"], scoped: true },
  { re: /^\/organizador\/eventos\/([^/]+)\/lotes(\/|$)/, keys: ["batches.create", "batches.edit", "batches.delete"], scoped: true },
  { re: /^\/organizador\/eventos\/([^/]+)\/categorias(\/|$)/, keys: ["categories.create", "categories.edit", "categories.delete"], scoped: true },
  { re: /^\/organizador\/eventos\/([^/]+)\/percursos(\/|$)/, keys: ["routes.create", "routes.edit", "routes.delete"], scoped: true },
  { re: /^\/organizador\/eventos\/([^/]+)\/cupons\/relatorio(\/|$)/, keys: ["coupons.report-export"], scoped: true },
  { re: /^\/organizador\/eventos\/([^/]+)\/cupons(\/|$)/, keys: ["coupons.view", "coupons.create", "coupons.edit", "coupons.delete"], scoped: true },
  { re: /^\/organizador\/eventos\/([^/]+)\/campanhas(\/|$)/, keys: ["campaigns.view", "campaigns.create", "campaigns.edit", "campaigns.cancel"], scoped: true },
  { re: /^\/organizador\/eventos\/([^/]+)\/redes-sociais(\/|$)/, keys: ["social-links.view", "social-links.create", "social-links.edit", "social-links.delete"], scoped: true },
  { re: /^\/organizador\/eventos\/([^/]+)\/patrocinio(\/|$)/, keys: ["sponsors.view", "sponsors.create", "sponsors.edit", "sponsors.delete"], scoped: true },
  { re: /^\/organizador\/eventos\/([^/]+)\/resultados(\/|$)/, keys: ["results.import", "results.publish"], scoped: true },
  { re: /^\/organizador\/eventos\/([^/]+)\/relatorio-geral(\/|$)/, keys: ["reports.export", "registrations.view"], scoped: true },
  { re: /^\/organizador\/eventos\/([^/]+)\/entrega-kits(\/|$)/, keys: ["kits.view", "kits.deliver"], scoped: true },
  { re: /^\/organizador\/eventos\/([^/]+)\/?$/, keys: EVENT_SCOPED_ACTIONS, scoped: true },
];

function normalizePath(pathname: string): string {
  const p = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "");
  return p === "" && pathname.startsWith("/organizador") ? "/organizador" : p;
}

/**
 * Um ASSISTANT de organizador pode acessar `pathname`? ADMIN/ORGANIZER/assistente-de-admin: sempre.
 * Rota desconhecida sob `/organizador/` → nega (fail-safe). `pathname` vazio (header ausente) →
 * nega pra assistente, o que é seguro: derruba pra /acesso-negado em vez de vazar.
 */
export async function resolveOrganizerAccess(session: Session, pathname: string): Promise<boolean> {
  const role = session.user.role;
  if (role === "ADMIN" || role === "ORGANIZER") return true;
  if (role !== "ASSISTANT") return false;

  const scope = await resolveActingScope(session);
  if (scope.actingAsAdmin) return true;
  if (!scope.organizerId) return false;

  const path = normalizePath(pathname);
  if (!path.startsWith("/organizador")) return false;

  const rule = ROUTE_RULES.find((r) => r.re.test(path));
  if (!rule) return false; // rota nova sem regra: nega até alguém mapear
  if ("titularOnly" in rule) return false;
  if ("anyStaff" in rule) return true;

  const eventId = rule.scoped ? path.match(rule.re)?.[1] : undefined;
  return assistantHasAnyPermission(session.user.id, rule.keys, eventId);
}

/** Itens de nav que a sessão pode ver. Titular / assistente-de-admin: todos. */
export async function organizerNavItems(session: Session): Promise<OrganizerNavItem[]> {
  const role = session.user.role;
  if (role === "ADMIN" || role === "ORGANIZER") return ORGANIZER_NAV;
  if (role !== "ASSISTANT") return [];

  const scope = await resolveActingScope(session);
  if (scope.actingAsAdmin) return ORGANIZER_NAV;
  if (!scope.organizerId) return [];

  const items: OrganizerNavItem[] = [];
  for (const item of ORGANIZER_NAV) {
    if (item.actionKeys.length === 0) continue; // só titular
    if (item.actionKeys.includes("*")) continue; // dashboard: assistente é redirecionado
    const ids = await assistantPermittedEventIds(session.user.id, item.actionKeys);
    if (ids === null || ids.length > 0) items.push(item);
  }
  return items;
}
