import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const schema = z.object({
  path: z.string().min(1).max(500),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Caminho inválido" }, { status: 400 });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "PAGE_VIEWED",
      entityType: "Page",
      entityId: parsed.data.path,
      metadata: { path: parsed.data.path },
    },
  });

  return NextResponse.json({ ok: true });
}
