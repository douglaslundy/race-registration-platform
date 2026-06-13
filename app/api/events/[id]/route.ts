import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const updateEventSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().optional(),
  modality: z.enum(["ROAD_RACE", "TRAIL_RUN", "MTB", "CYCLING", "WALK", "TRIATHLON", "OTHER"]).optional(),
  startAt: z.string().datetime().optional(),
  kitPickupAt: z.string().datetime().optional().nullable(),
  venueName: z.string().optional(),
  addressLine: z.string().optional(),
  city: z.string().min(2).optional(),
  state: z.string().length(2).optional(),
  maxParticipants: z.number().int().positive().optional().nullable(),
  organizerContact: z.string().optional().nullable(),
  bannerUrl: z.string().url().optional().nullable(),
  regulationUrl: z.string().url().optional().nullable(),
  regulationText: z.string().optional().nullable(),
  status: z.enum(["DRAFT", "UNDER_REVIEW"]).optional(),
});

async function getEventAndVerifyOwner(eventId: string, userId: string) {
  const organizer = await db.organizerProfile.findUnique({ where: { userId } });
  if (!organizer) return null;

  const event = await db.event.findFirst({
    where: { id: eventId, organizerId: organizer.id },
  });
  return event;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const parsed = updateEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const event = session.user.role === "ADMIN"
    ? await db.event.findUnique({ where: { id } })
    : await getEventAndVerifyOwner(id, session.user.id);

  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const updated = await db.event.update({
    where: { id },
    data: {
      ...parsed.data,
      ...(parsed.data.startAt ? { startAt: new Date(parsed.data.startAt) } : {}),
      ...(parsed.data.kitPickupAt !== undefined ? { kitPickupAt: parsed.data.kitPickupAt ? new Date(parsed.data.kitPickupAt) : null } : {}),
    },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "EVENT_UPDATED",
      entityType: "Event",
      entityId: id,
      metadata: parsed.data,
    },
  });

  return NextResponse.json({ event: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;

  const event = session.user.role === "ADMIN"
    ? await db.event.findUnique({ where: { id } })
    : await getEventAndVerifyOwner(id, session.user.id);

  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
  if (!["DRAFT", "CANCELLED"].includes(event.status)) {
    return NextResponse.json({ error: "Só é possível arquivar eventos em rascunho ou cancelados" }, { status: 409 });
  }

  await db.event.update({ where: { id }, data: { status: "CANCELLED" } });

  return NextResponse.json({ ok: true });
}
