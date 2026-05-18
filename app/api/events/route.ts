import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { slugify } from "@/lib/format";

const createEventSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().optional(),
  modality: z.enum(["ROAD_RACE", "TRAIL_RUN", "MTB", "CYCLING", "WALK", "TRIATHLON", "OTHER"]),
  startAt: z.string().datetime(),
  kitPickupAt: z.string().datetime().optional(),
  venueName: z.string().optional(),
  addressLine: z.string().optional(),
  city: z.string().min(2),
  state: z.string().length(2),
  maxParticipants: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !["ORGANIZER", "ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const organizer = await db.organizerProfile.findUnique({
    where: { userId: session.user.id },
  });
  if (!organizer) {
    return NextResponse.json({ error: "Perfil de organizador não encontrado" }, { status: 404 });
  }

  const slug = slugify(parsed.data.title) + "-" + Date.now();

  const event = await db.event.create({
    data: {
      ...parsed.data,
      slug,
      organizerId: organizer.id,
      startAt: new Date(parsed.data.startAt),
      kitPickupAt: parsed.data.kitPickupAt ? new Date(parsed.data.kitPickupAt) : undefined,
    },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "EVENT_CREATED",
      entityType: "Event",
      entityId: event.id,
    },
  });

  return NextResponse.json({ event }, { status: 201 });
}
