import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createOrPromoteAssistant } from "@/lib/assistants/create-or-promote";
import { buildScopes } from "@/lib/assistants/list";

const schema = z.object({
  email: z.string().email("E-mail inválido"),
  name: z.string().min(1, "Nome é obrigatório"),
  actionKeys: z.array(z.string()),
  // Admin é global: escopo por evento é opcional. "ALL"/ausente = todos os eventos.
  eventId: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  let eventId: string | null = null;
  if (parsed.data.eventId && parsed.data.eventId !== "ALL") {
    const ev = await db.event.findUnique({ where: { id: parsed.data.eventId }, select: { id: true } });
    if (!ev) return NextResponse.json({ error: "Evento não encontrado." }, { status: 400 });
    eventId = ev.id;
  }

  const result = await createOrPromoteAssistant({
    email: parsed.data.email,
    name: parsed.data.name,
    actionKeys: parsed.data.actionKeys,
    createdByUserId: session.user.id,
    invitedByName: session.user.name,
    ...(eventId ? { eventId } : {}),
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ userId: result.userId, isNew: result.isNew }, { status: 201 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const users = await db.user.findMany({
    where: { role: "ASSISTANT" },
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
