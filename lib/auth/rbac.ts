import type { UserRole, AdvertiserProfile } from "@prisma/client";
import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { auth } from "./index";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";

export async function requireAuth() {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");
  // Conta bloqueada com sessão viva (ver proxy.ts) — defesa dos Server Components.
  if (session.user.active === false) redirect("/acesso-negado");
  return session;
}

export async function requireRole(roles: UserRole[]) {
  const session = await requireAuth();
  if (!roles.includes(session.user.role as UserRole)) {
    redirect("/acesso-negado");
  }
  return session;
}

export interface AssistantScope {
  actingAsAdmin: boolean;
  organizerId: string | null;
}

/**
 * Resolve o escopo efetivo de atuação de uma sessão. ADMIN/ORGANIZER titulares
 * resolvem sem consulta extra (ADMIN) ou com a mesma consulta que as rotas já
 * faziam individualmente (ORGANIZER). Só ASSISTANT precisa de uma consulta nova,
 * subindo até o criador pra saber se ele age como admin (irrestrito) ou como
 * organizador (confinado ao organizerId do criador).
 */
export async function resolveActingScope(session: Session): Promise<AssistantScope> {
  if (session.user.role === "ADMIN") return { actingAsAdmin: true, organizerId: null };

  if (session.user.role === "ORGANIZER") {
    const profile = await db.organizerProfile.findUnique({ where: { userId: session.user.id } });
    return { actingAsAdmin: false, organizerId: profile?.id ?? null };
  }

  if (session.user.role === "ASSISTANT") {
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { createdBy: { select: { role: true, organizerProfile: { select: { id: true } } } } },
    });
    if (user?.createdBy?.role === "ADMIN") return { actingAsAdmin: true, organizerId: null };
    if (user?.createdBy?.organizerProfile) {
      return { actingAsAdmin: false, organizerId: user.createdBy.organizerProfile.id };
    }
    return { actingAsAdmin: false, organizerId: null };
  }

  return { actingAsAdmin: false, organizerId: null };
}

export type PermissionCheck =
  | { allowed: true; session: Session }
  | { allowed: false; response: NextResponse };

/** Opções das checagens de permissão. `eventId` restringe a checagem a um evento: um ASSISTANT
 * autoriza se tiver uma linha global (`eventId = null`, vale pra todos os eventos) OU uma linha
 * específica daquele evento. Sem `eventId`, só linhas globais autorizam — é o comportamento
 * seguro: um assistente confinado a 1 evento não ganha acesso "global" por engano.
 *
 * `anyScope`: para telas-lançador que listam só o que o assistente pode (ex.: `/organizador/entrega-kits`,
 * que já filtra os eventos via `assistantPermittedEventIds`). Aí qualquer linha — global OU de
 * qualquer evento — autoriza a ENTRAR; o escopo real é aplicado pela própria página. Nunca usar
 * `anyScope` numa tela que mostra dados agregados de todos os eventos. */
export interface PermissionOptions {
  eventId?: string;
  anyScope?: boolean;
}

/** Resolve se um ASSISTANT tem QUALQUER uma das actionKeys, respeitando o escopo de evento.
 * Sem `eventId`: só linhas com `eventId = null`. Com `eventId`: linhas globais OU do evento.
 * Com `anyScope`: qualquer linha (global ou de qualquer evento). */
export async function assistantHasAnyPermission(
  userId: string,
  actionKeys: string[],
  eventId?: string,
  anyScope?: boolean,
): Promise<boolean> {
  const scopeFilter = anyScope
    ? {}
    : eventId
      ? { OR: [{ eventId: null }, { eventId }] }
      : { eventId: null };
  const row = await db.assistantPermission.findFirst({
    where: { userId, actionKey: { in: actionKeys }, ...scopeFilter },
  });
  return row !== null;
}

/** Checagem de permissão pra uso em Route Handlers (retorna NextResponse, não redireciona). */
export async function checkApiPermission(
  actionKey: string,
  opts?: PermissionOptions,
): Promise<PermissionCheck> {
  const session = await auth();
  if (!session?.user) {
    return { allowed: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }
  if (session.user.active === false) {
    return { allowed: false, response: NextResponse.json({ error: "Conta bloqueada" }, { status: 403 }) };
  }

  if (session.user.role === "ADMIN" || session.user.role === "ORGANIZER") {
    return { allowed: true, session };
  }

  if (session.user.role === "ASSISTANT") {
    if (await assistantHasAnyPermission(session.user.id, [actionKey], opts?.eventId, opts?.anyScope)) {
      return { allowed: true, session };
    }
  }

  return { allowed: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 403 }) };
}

/** Como checkApiPermission, mas passa se o ASSISTANT tiver QUALQUER uma das actionKeys (ex.: a
 * busca da tela de entrega de kits serve tanto pra quem tem `kits.view` quanto pra quem só tem
 * `kits.deliver`). ADMIN/ORGANIZER titulares sempre passam. */
export async function checkAnyApiPermission(
  actionKeys: string[],
  opts?: PermissionOptions,
): Promise<PermissionCheck> {
  const session = await auth();
  if (!session?.user) {
    return { allowed: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }
  if (session.user.active === false) {
    return { allowed: false, response: NextResponse.json({ error: "Conta bloqueada" }, { status: 403 }) };
  }

  if (session.user.role === "ADMIN" || session.user.role === "ORGANIZER") {
    return { allowed: true, session };
  }

  if (session.user.role === "ASSISTANT") {
    if (await assistantHasAnyPermission(session.user.id, actionKeys, opts?.eventId, opts?.anyScope)) {
      return { allowed: true, session };
    }
  }

  return { allowed: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 403 }) };
}

/**
 * Checagem de permissão estritamente ADMIN pra uso em Route Handlers. Diferente de
 * checkApiPermission, NUNCA libera ORGANIZER titular, e só libera ASSISTANT quando
 * resolveActingScope confirma que ele age como admin (criado por um ADMIN) — um
 * ASSISTANT-de-organizador com a AssistantPermission gravada por engano continua barrado.
 */
export async function checkAdminOnlyApiPermission(actionKey: string): Promise<PermissionCheck> {
  const session = await auth();
  if (!session?.user) {
    return { allowed: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }
  if (session.user.active === false) {
    return { allowed: false, response: NextResponse.json({ error: "Conta bloqueada" }, { status: 403 }) };
  }

  if (session.user.role === "ADMIN") {
    return { allowed: true, session };
  }

  if (session.user.role === "ASSISTANT") {
    // Ações admin-only nunca são escopadas por evento: só linha global (eventId null) autoriza.
    const granted = await db.assistantPermission.findFirst({
      where: { userId: session.user.id, actionKey, eventId: null },
    });
    if (granted) {
      const scope = await resolveActingScope(session);
      if (scope.actingAsAdmin) return { allowed: true, session };
    }
  }

  return { allowed: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 403 }) };
}

export type AdvertiserPermissionCheck =
  | { allowed: true; session: Session; advertiser: AdvertiserProfile | null }
  | { allowed: false; response: NextResponse };

/** Checagem de auth pras rotas de API do anunciante — mesmo formato de checkApiPermission, mas
 * também resolve o AdvertiserProfile (evita cada rota repetir a mesma query). Nunca decide 404
 * sozinho por perfil ausente: advertiser pode vir null, e cada rota decide o que fazer (algumas
 * tratam ausência como 404, outras como estado válido — ex. perfil ainda não criado). */
export async function checkAdvertiserApiPermission(): Promise<AdvertiserPermissionCheck> {
  const session = await auth();
  if (!session?.user) {
    return { allowed: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }
  if (session.user.active === false) {
    return { allowed: false, response: NextResponse.json({ error: "Conta bloqueada" }, { status: 403 }) };
  }
  if (session.user.role !== "ADVERTISER") {
    return { allowed: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 403 }) };
  }
  const advertiser = await db.advertiserProfile.findUnique({ where: { userId: session.user.id } });
  return { allowed: true, session, advertiser };
}

export async function requireAdmin() {
  const session = await requireAuth();
  if (session.user.role === "ADMIN") return session;
  if (session.user.role === "ASSISTANT") {
    const scope = await resolveActingScope(session);
    if (scope.actingAsAdmin) return session;
  }
  redirect("/acesso-negado");
}

export async function requireOrganizer() {
  const session = await requireAuth();
  if (session.user.role === "ADMIN" || session.user.role === "ORGANIZER") return session;
  if (session.user.role === "ASSISTANT") {
    const scope = await resolveActingScope(session);
    if (scope.actingAsAdmin || scope.organizerId !== null) return session;
  }
  redirect("/acesso-negado");
}

/** Checagem de permissão pra uso em Server Components (páginas) — redireciona em vez de
 * retornar uma NextResponse. Mesma lógica de checkApiPermission: ADMIN/ORGANIZER titulares
 * sempre passam; ASSISTANT precisa da AssistantPermission gravada pra essa actionKey. */
export async function requirePermission(actionKey: string, opts?: PermissionOptions) {
  const session = await requireAuth();

  if (session.user.role === "ADMIN" || session.user.role === "ORGANIZER") {
    return session;
  }

  if (session.user.role === "ASSISTANT") {
    if (await assistantHasAnyPermission(session.user.id, [actionKey], opts?.eventId, opts?.anyScope)) {
      return session;
    }
  }

  redirect("/acesso-negado");
}

/** Como requirePermission, mas passa se o ASSISTANT tiver QUALQUER uma das actionKeys informadas
 * (ex: a página de entrega de kits serve tanto pra quem só vê quanto pra quem confirma a entrega). */
export async function requireAnyPermission(actionKeys: string[], opts?: PermissionOptions) {
  const session = await requireAuth();

  if (session.user.role === "ADMIN" || session.user.role === "ORGANIZER") {
    return session;
  }

  if (session.user.role === "ASSISTANT") {
    if (await assistantHasAnyPermission(session.user.id, actionKeys, opts?.eventId, opts?.anyScope)) {
      return session;
    }
  }

  redirect("/acesso-negado");
}

/** Eventos aos quais um ASSISTANT tem alguma das actionKeys. Retorna `null` quando ele tem
 * permissão GLOBAL (linha `eventId = null`) — o chamador deve interpretar como "todos os eventos".
 * Retorna a lista de ids quando as permissões são todas restritas a eventos específicos. */
export async function assistantPermittedEventIds(
  userId: string,
  actionKeys: string[],
): Promise<string[] | null> {
  const rows = await db.assistantPermission.findMany({
    where: { userId, actionKey: { in: actionKeys } },
    select: { eventId: true },
  });
  if (rows.some((r) => r.eventId === null)) return null;
  return Array.from(new Set(rows.map((r) => r.eventId).filter((id): id is string => id !== null)));
}
