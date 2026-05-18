import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const routeSchema = z.object({
  name: z.string().min(1),
  distanceKm: z.number().positive(),
  description: z.string().optional().nullable(),
});

async function getOrganizerEvent(eventId: string, userId: string) {
  return db.event.findFirst({
    where: { id: eventId, organizer: { userId } },
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const routes = await db.eventRoute.findMany({
    where: { eventId: id },
    orderBy: { distanceKm: "asc" },
  });
  return NextResponse.json({ routes });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const event = await getOrganizerEvent(id, session.user.id);
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = routeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const route = await db.eventRoute.create({
    data: { eventId: id, ...parsed.data },
  });

  return NextResponse.json({ route }, { status: 201 });
}
