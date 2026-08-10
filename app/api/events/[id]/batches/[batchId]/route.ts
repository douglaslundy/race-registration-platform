import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  priceAmount: z.number().int().nonnegative().optional(),
  capacity: z.number().int().positive().optional(),
  active: z.boolean().optional(),
  isActive: z.boolean().optional(),
  activationMode: z.enum(["MANUAL", "DATE", "AFTER_PREVIOUS"]).optional(),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; batchId: string }> }) {
  const check = await checkApiPermission("batches.edit");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, batchId } = await params;
  const scope = await resolveActingScope(session);

  const event = await db.event.findFirst({
    where: { id, organizerId: scope.organizerId ?? "__none__" },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const existingBatch = await db.ticketBatch.findFirst({ where: { id: batchId, eventId: id } });
  if (!existingBatch) return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { isActive, startAt, endAt, ...rest } = parsed.data;
  const batch = await db.ticketBatch.update({
    where: { id: batchId },
    data: {
      ...rest,
      ...(isActive !== undefined ? { active: isActive } : {}),
      ...(startAt ? { startAt: new Date(startAt) } : {}),
      ...(endAt ? { endAt: new Date(endAt) } : {}),
    },
  });


  return NextResponse.json({ batch });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; batchId: string }> }) {
  const check = await checkApiPermission("batches.delete");
  if (!check.allowed) return check.response;
  const { session } = check;

  const { id, batchId } = await params;
  const scope = await resolveActingScope(session);

  const event = await db.event.findFirst({
    where: { id, organizerId: scope.organizerId ?? "__none__" },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const existingBatch = await db.ticketBatch.findFirst({ where: { id: batchId, eventId: id } });
  if (!existingBatch) return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });

  await db.ticketBatch.delete({ where: { id: batchId } });
  return NextResponse.json({ success: true });
}
