import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const event = await db.event.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  await db.event.update({
    where: { id },
    data: {
      status: "REGISTRATIONS_OPEN",
      publishedAt: new Date(),
    },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "EVENT_APPROVED",
      entityType: "Event",
      entityId: id,
    },
  });

  return NextResponse.json({ ok: true });
}
