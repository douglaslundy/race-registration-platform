import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await checkApiPermission("events.archive", { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);

  const event = await db.event.findFirst({
    where: {
      id,
      ...(scope.actingAsAdmin ? {} : { organizerId: scope.organizerId ?? "__none__" }),
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
