import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
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
  maxParticipants: z.number().int().nonnegative().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const check = await checkApiPermission("events.create");
  if (!check.allowed) return check.response;
  const { session } = check;

  const body = await req.json();
  const parsed = createEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const scope = await resolveActingScope(session);
  if (!scope.organizerId) {
    return NextResponse.json({ error: "Perfil de organizador não encontrado" }, { status: 404 });
  }

  const slug = slugify(parsed.data.title) + "-" + Date.now();

  const event = await db.event.create({
    data: {
      ...parsed.data,
      maxParticipants: parsed.data.maxParticipants === 0 ? null : parsed.data.maxParticipants ?? null,
      slug,
      organizerId: scope.organizerId,
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
