import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteAssistant, updateAssistant } from "@/lib/assistants/manage";
import { resolveActingScope } from "@/lib/auth/rbac";

const schema = z.object({ active: z.boolean() });

const putSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  scopes: z
    .array(
      z.object({
        eventId: z.string().min(1).nullable(),
        actionKeys: z.array(z.string()),
      }),
    )
    .max(50),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ORGANIZER") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const target = await db.user.findUnique({ where: { id } });
  if (!target || target.role !== "ASSISTANT" || target.createdByUserId !== session.user.id) {
    return NextResponse.json({ error: "Assistente não encontrado" }, { status: 404 });
  }

  await db.user.update({ where: { id }, data: { active: parsed.data.active } });
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ORGANIZER") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // Cada eventId não-nulo tem que ser de um evento do próprio organizador.
  const eventIds = Array.from(
    new Set(parsed.data.scopes.map((s) => s.eventId).filter((e): e is string => e !== null)),
  );
  if (eventIds.length > 0) {
    const scope = await resolveActingScope(session);
    const owned = scope.organizerId
      ? await db.event.findMany({
          where: { id: { in: eventIds }, organizerId: scope.organizerId },
          select: { id: true },
        })
      : [];
    if (owned.length !== eventIds.length) {
      return NextResponse.json({ error: "Um dos eventos é inválido ou não pertence a você." }, { status: 400 });
    }
  }

  const result = await updateAssistant({
    assistantId: id,
    name: parsed.data.name,
    scopes: parsed.data.scopes,
    requireCreatedByUserId: session.user.id,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "ASSISTANT_UPDATED",
      entityType: "User",
      entityId: id,
      metadata: { scopeCount: parsed.data.scopes.length },
    },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ORGANIZER") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const result = await deleteAssistant({ assistantId: id, requireCreatedByUserId: session.user.id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "ASSISTANT_DELETED",
      entityType: "User",
      entityId: id,
      metadata: { mode: result.mode ?? "deleted" },
    },
  });
  return NextResponse.json({ ok: true, mode: result.mode });
}
