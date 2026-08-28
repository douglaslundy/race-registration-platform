import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  url: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; sponsorId: string }> }) {
  const { id, sponsorId } = await params;
  const check = await checkApiPermission("sponsors.edit", { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const existing = await db.eventSponsor.findFirst({ where: { id: sponsorId, eventId: id } });
  if (!existing) return NextResponse.json({ error: "Patrocinador não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const sponsor = await db.eventSponsor.update({ where: { id: sponsorId }, data: parsed.data });
  return NextResponse.json({ sponsor });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; sponsorId: string }> }) {
  const { id, sponsorId } = await params;
  const check = await checkApiPermission("sponsors.delete", { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const existing = await db.eventSponsor.findFirst({ where: { id: sponsorId, eventId: id } });
  if (!existing) return NextResponse.json({ error: "Patrocinador não encontrado" }, { status: 404 });

  await db.eventSponsor.delete({ where: { id: sponsorId } });
  return NextResponse.json({ success: true });
}
