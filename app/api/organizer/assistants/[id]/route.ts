import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteAssistant } from "@/lib/assistants/manage";

const schema = z.object({ active: z.boolean() });

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
