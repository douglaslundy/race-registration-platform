import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const schema = z.object({ active: z.boolean() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const target = await db.user.findUnique({ where: { id } });
  if (!target || target.role !== "ASSISTANT") {
    return NextResponse.json({ error: "Assistente não encontrado" }, { status: 404 });
  }

  await db.user.update({ where: { id }, data: { active: parsed.data.active } });
  return NextResponse.json({ ok: true });
}
