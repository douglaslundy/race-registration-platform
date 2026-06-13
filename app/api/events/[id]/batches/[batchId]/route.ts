import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  priceAmount: z.number().int().positive().optional(),
  capacity: z.number().int().positive().optional(),
  active: z.boolean().optional(),
  isActive: z.boolean().optional(),
  activationMode: z.enum(["MANUAL", "DATE", "AFTER_PREVIOUS"]).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; batchId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id, batchId } = await params;

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { isActive, ...rest } = parsed.data;
  const batch = await db.ticketBatch.update({
    where: { id: batchId },
    data: {
      ...rest,
      ...(isActive !== undefined ? { active: isActive } : {}),
    },
  });


  return NextResponse.json({ batch });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; batchId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id, batchId } = await params;

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  await db.ticketBatch.delete({ where: { id: batchId } });
  return NextResponse.json({ success: true });
}
