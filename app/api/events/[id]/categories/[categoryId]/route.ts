import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  minAge: z.number().int().nonnegative().nullable().optional(),
  maxAge: z.number().int().nonnegative().nullable().optional(),
  gender: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; categoryId: string }> }) {
  const check = await checkApiPermission("categories.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, categoryId } = await params;
  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const existingCategory = await db.eventCategory.findFirst({ where: { id: categoryId, eventId: id } });
  if (!existingCategory) return NextResponse.json({ error: "Categoria não encontrada" }, { status: 404 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const category = await db.eventCategory.update({ where: { id: categoryId }, data: parsed.data });
  return NextResponse.json({ category });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; categoryId: string }> }) {
  const check = await checkApiPermission("categories.delete");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, categoryId } = await params;
  const scope = await resolveActingScope(session);

  const event = await db.event.findFirst({
    where: { id, organizerId: scope.organizerId ?? "__none__" },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const existingCategory = await db.eventCategory.findFirst({ where: { id: categoryId, eventId: id } });
  if (!existingCategory) return NextResponse.json({ error: "Categoria não encontrada" }, { status: 404 });

  await db.eventCategory.delete({ where: { id: categoryId } });
  return NextResponse.json({ success: true });
}
