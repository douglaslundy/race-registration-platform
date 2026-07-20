import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  priceAmount: z.number().int().positive(),
  durationDays: z.number().int().positive(),
  maxSimultaneousSlots: z.number().int().positive(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const plans = await db.adPlan.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json({ plans });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const plan = await db.adPlan.create({ data: { ...parsed.data, active: true } });
  return NextResponse.json({ plan }, { status: 201 });
}
