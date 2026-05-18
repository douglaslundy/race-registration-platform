import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;

  const event = await db.event.findFirst({
    where: {
      id,
      OR: [
        { organizer: { userId: session.user.id } },
        ...(session.user.role === "ADMIN" ? [{ id }] : []),
      ],
    },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  if (["COMPLETED", "CANCELLED"].includes(event.status)) {
    return NextResponse.json({ error: "Evento já arquivado/cancelado" }, { status: 400 });
  }

  await db.event.update({
    where: { id },
    data: { status: "CANCELLED" },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "EVENT_CANCELLED",
      entityType: "Event",
      entityId: id,
    },
  });

  return NextResponse.json({ success: true });
}
