import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { z } from "zod";

const patchSchema = z.object({
  platform: z.string().trim().min(1).optional(),
  url: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1).optional(),
  maxSends: z.number().int().positive().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const { id, linkId } = await params;
  const check = await checkApiPermission("social-links.edit", { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const existing = await db.eventSocialLink.findFirst({ where: { id: linkId, eventId: id } });
  if (!existing) return NextResponse.json({ error: "Rede social não encontrada" }, { status: 404 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const socialLink = await db.eventSocialLink.update({ where: { id: linkId }, data: parsed.data });
  return NextResponse.json({ socialLink });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const { id, linkId } = await params;
  const check = await checkApiPermission("social-links.delete", { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const existing = await db.eventSocialLink.findFirst({ where: { id: linkId, eventId: id } });
  if (!existing) return NextResponse.json({ error: "Rede social não encontrada" }, { status: 404 });

  await db.eventSocialLink.delete({ where: { id: linkId } });
  return NextResponse.json({ success: true });
}
