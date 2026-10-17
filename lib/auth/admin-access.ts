import type { Session } from "next-auth";
import { assistantHasAnyPermission } from "./rbac";

/**
 * Controle de acesso da área `/admin/*` para ASSISTANT. O ADMIN titular passa sempre; o assistente
 * (mesmo criado por admin) só entra nas rotas abaixo e só com a AssistantPermission da rota.
 * Rota sem regra → nega (fail-safe). As demais páginas usam `requireAdmin()` e são só do ADMIN.
 */
const ADMIN_ASSISTANT_RULES: { re: RegExp; href: string; keys: string[]; anyScope?: boolean }[] = [
  { re: /^\/admin\/entrega-kits(\/|$)/, href: "/admin/entrega-kits", keys: ["kits.view", "kits.deliver"], anyScope: true },
  { re: /^\/admin\/campanhas(\/|$)/, href: "/admin/campanhas", keys: ["campaigns.view"] },
  { re: /^\/admin\/mensagens(\/|$)/, href: "/admin/mensagens", keys: ["messages.view"] },
];

export async function resolveAdminAccess(session: Session, pathname: string): Promise<boolean> {
  if (session.user.role === "ADMIN") return true;
  if (session.user.role !== "ASSISTANT") return false;
  const path = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "");
  const rule = ADMIN_ASSISTANT_RULES.find((r) => r.re.test(path));
  if (!rule) return false;
  return assistantHasAnyPermission(session.user.id, rule.keys, undefined, rule.anyScope);
}

/** hrefs do menu /admin que a sessão pode ver; `null` = todos (ADMIN titular). */
export async function adminNavHrefs(session: Session): Promise<string[] | null> {
  if (session.user.role === "ADMIN") return null;
  const hrefs: string[] = [];
  for (const r of ADMIN_ASSISTANT_RULES) {
    if (await assistantHasAnyPermission(session.user.id, r.keys, undefined, r.anyScope)) hrefs.push(r.href);
  }
  return hrefs;
}
