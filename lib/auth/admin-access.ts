import type { Session } from "next-auth";
import { assistantHasAnyPermission } from "./rbac";

/**
 * Controle de acesso da área `/admin/*` para ASSISTANT. O ADMIN titular passa sempre; o assistente
 * (mesmo criado por admin) só entra nas rotas abaixo e só com a AssistantPermission da rota.
 * Rota sem regra → nega (fail-safe). As demais páginas usam `requireAdmin()` e são só do ADMIN.
 */
const ADMIN_ASSISTANT_RULES: { re: RegExp; href: string; label: string; keys: string[]; anyScope?: boolean }[] = [
  { re: /^\/admin\/entrega-kits(\/|$)/, href: "/admin/entrega-kits", label: "Entrega de kits", keys: ["kits.view", "kits.deliver"], anyScope: true },
  { re: /^\/admin\/campanhas(\/|$)/, href: "/admin/campanhas", label: "Campanhas", keys: ["campaigns.view"] },
  { re: /^\/admin\/mensagens(\/|$)/, href: "/admin/mensagens", label: "Mensagens", keys: ["messages.view"] },
];

export async function resolveAdminAccess(session: Session, pathname: string): Promise<boolean> {
  if (session.user.role === "ADMIN") return true;
  if (session.user.role !== "ASSISTANT") return false;
  const path = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "");
  const rule = ADMIN_ASSISTANT_RULES.find((r) => r.re.test(path));
  if (!rule) return false;
  return assistantHasAnyPermission(session.user.id, rule.keys, undefined, rule.anyScope);
}

/** Itens de /admin que o assistente pode abrir (ADMIN titular não usa isto). */
export async function adminAssistantItems(session: Session): Promise<{ href: string; label: string }[]> {
  const items: { href: string; label: string }[] = [];
  for (const r of ADMIN_ASSISTANT_RULES) {
    if (await assistantHasAnyPermission(session.user.id, r.keys, undefined, r.anyScope)) {
      items.push({ href: r.href, label: r.label });
    }
  }
  return items;
}

/** hrefs do menu /admin que a sessão pode ver; `null` = todos (ADMIN titular). */
export async function adminNavHrefs(session: Session): Promise<string[] | null> {
  if (session.user.role === "ADMIN") return null;
  return (await adminAssistantItems(session)).map((i) => i.href);
}
