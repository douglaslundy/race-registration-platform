import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

/**
 * Gestão dos PDFs de resultado da página pública (`/eventos/[slug]/resultados`).
 * `POST`  — cadastra um PDF (nome de exibição + URL já enviada pelo `/api/upload`).
 * `PATCH` — grava o texto de destaque (`Event.resultsSubtitle`).
 * Ambas sob a permissão `results.import` + checagem anti‑IDOR por `organizerId`.
 */

const createSchema = z.object({
  label: z.string().trim().min(1).max(80),
  fileUrl: z.string().url().max(500),
  fileName: z.string().trim().min(1).max(200),
});

const subtitleSchema = z.object({
  resultsSubtitle: z.string().max(120).nullable(),
});

async function resolveEvent(eventId: string, session: Session) {
  const scope = await resolveActingScope(session);
  return scope.actingAsAdmin
    ? db.event.findUnique({ where: { id: eventId } })
    : db.event.findFirst({ where: { id: eventId, organizerId: scope.organizerId ?? "__none__" } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await checkApiPermission("results.import", { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const event = await resolveEvent(id, session);
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const created = await db.eventResultFile.create({
    data: {
      eventId: id,
      label: parsed.data.label,
      fileUrl: parsed.data.fileUrl,
      fileName: parsed.data.fileName,
      createdById: session.user.id,
    },
  });
  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "RESULT_FILE_ADDED",
      entityType: "EventResultFile",
      entityId: created.id,
      metadata: { eventId: id, label: created.label, fileName: created.fileName },
    },
  });

  return NextResponse.json(
    { id: created.id, label: created.label, fileUrl: created.fileUrl, fileName: created.fileName, createdAt: created.createdAt },
    { status: 201 },
  );
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await checkApiPermission("results.import", { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const event = await resolveEvent(id, session);
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const parsed = subtitleSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  await db.event.update({
    where: { id },
    data: { resultsSubtitle: parsed.data.resultsSubtitle?.trim() || null },
  });
  return NextResponse.json({ ok: true });
}
