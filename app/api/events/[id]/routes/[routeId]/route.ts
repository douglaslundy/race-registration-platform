import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  distanceKm: z.number().positive().optional(),
  description: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; routeId: string }> }) {
  const check = await checkApiPermission("routes.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, routeId } = await params;
  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const existingRoute = await db.eventRoute.findFirst({ where: { id: routeId, eventId: id } });
  if (!existingRoute) return NextResponse.json({ error: "Percurso não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const route = await db.eventRoute.update({ where: { id: routeId }, data: parsed.data });
  return NextResponse.json({ route });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; routeId: string }> }) {
  const check = await checkApiPermission("routes.delete");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, routeId } = await params;
  const scope = await resolveActingScope(session);

  const event = await db.event.findFirst({
    where: { id, organizerId: scope.organizerId ?? "__none__" },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const existingRoute = await db.eventRoute.findFirst({ where: { id: routeId, eventId: id } });
  if (!existingRoute) return NextResponse.json({ error: "Percurso não encontrado" }, { status: 404 });

  await db.eventRoute.delete({ where: { id: routeId } });
  return NextResponse.json({ success: true });
}
