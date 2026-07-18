import type { UserRole } from "@prisma/client";
import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { auth } from "./index";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";

export async function requireAuth() {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");
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

/** Checagem de permissão pra uso em Route Handlers (retorna NextResponse, não redireciona). */
export async function checkApiPermission(actionKey: string): Promise<PermissionCheck> {
  const session = await auth();
  if (!session?.user) {
    return { allowed: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }

  if (session.user.role === "ADMIN" || session.user.role === "ORGANIZER") {
    return { allowed: true, session };
  }

  if (session.user.role === "ASSISTANT") {
    const granted = await db.assistantPermission.findUnique({
      where: { userId_actionKey: { userId: session.user.id, actionKey } },
    });
    if (granted) return { allowed: true, session };
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

  if (session.user.role === "ADMIN") {
    return { allowed: true, session };
  }

  if (session.user.role === "ASSISTANT") {
    const granted = await db.assistantPermission.findUnique({
      where: { userId_actionKey: { userId: session.user.id, actionKey } },
    });
    if (granted) {
      const scope = await resolveActingScope(session);
      if (scope.actingAsAdmin) return { allowed: true, session };
    }
  }

  return { allowed: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 403 }) };
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
export async function requirePermission(actionKey: string) {
  const session = await requireAuth();

  if (session.user.role === "ADMIN" || session.user.role === "ORGANIZER") {
    return session;
  }

  if (session.user.role === "ASSISTANT") {
    const granted = await db.assistantPermission.findUnique({
      where: { userId_actionKey: { userId: session.user.id, actionKey } },
    });
    if (granted) return session;
  }

  redirect("/acesso-negado");
}
