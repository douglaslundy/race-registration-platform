import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const categorySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  minAge: z.number().int().optional().nullable(),
  maxAge: z.number().int().optional().nullable(),
  gender: z.string().optional().nullable(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const categories = await db.eventCategory.findMany({
    where: { eventId: id },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ categories });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = categorySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const category = await db.eventCategory.create({
    data: { eventId: id, ...parsed.data },
  });

  return NextResponse.json({ category }, { status: 201 });
}
