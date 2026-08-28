import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createOrPromoteAssistant } from "@/lib/assistants/create-or-promote";
import { buildScopes } from "@/lib/assistants/list";
import { resolveActingScope } from "@/lib/auth/rbac";

const schema = z.object({
  email: z.string().email("E-mail inválido"),
  name: z.string().min(1, "Nome é obrigatório"),
  actionKeys: z.array(z.string()),
  // "ALL" = todos os eventos do organizador; senão um id de evento dele. Obrigatório.
  eventId: z.string().min(1, "Selecione o evento (ou 'Todos os eventos')"),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ORGANIZER") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  let eventId: string | null = null;
  if (parsed.data.eventId !== "ALL") {
    const scope = await resolveActingScope(session);
    const owned = scope.organizerId
      ? await db.event.findFirst({
          where: { id: parsed.data.eventId, organizerId: scope.organizerId },
          select: { id: true },
        })
      : null;
    if (!owned) {
      return NextResponse.json({ error: "Evento inválido ou não pertence a você." }, { status: 400 });
    }
    eventId = owned.id;
  }

  const result = await createOrPromoteAssistant({
    email: parsed.data.email,
    name: parsed.data.name,
    actionKeys: parsed.data.actionKeys,
    createdByUserId: session.user.id,
    invitedByName: session.user.name,
    eventId,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ userId: result.userId, isNew: result.isNew }, { status: 201 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ORGANIZER") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const users = await db.user.findMany({
    where: { role: "ASSISTANT", createdByUserId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      active: true,
      createdAt: true,
      passwordHash: true,
      assistantPermissions: { select: { actionKey: true, eventId: true } },
    },
  });

  const eventIds = Array.from(
    new Set(
      users.flatMap((u) =>
        u.assistantPermissions.map((p) => p.eventId).filter((id): id is string => typeof id === "string"),
      ),
    ),
  );
  const events = eventIds.length
    ? (await db.event.findMany({ where: { id: { in: eventIds } }, select: { id: true, title: true } })) ?? []
    : [];
  const titleById = new Map(events.map((e) => [e.id, e.title]));

  const assistants = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    active: u.active,
    createdAt: u.createdAt,
    signupPending: u.passwordHash === null,
    permissions: u.assistantPermissions.map((p) => p.actionKey),
    scopes: buildScopes(u.assistantPermissions, titleById),
  }));

  return NextResponse.json({ assistants });
}
