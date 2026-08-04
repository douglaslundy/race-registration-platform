import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; recipientId: string }> }) {
  const { id, recipientId } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!["ADMIN", "ORGANIZER", "ASSISTANT"].includes(session.user.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const scope = await resolveActingScope(session);
  const event = await db.event.findFirst({
    where: scope.actingAsAdmin ? { id } : { id, organizer: { userId: session.user.id } },
    select: { id: true },
  });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const recipient = await db.dailySummaryRecipient.findFirst({ where: { id: recipientId, eventId: id } });
  if (!recipient) return NextResponse.json({ error: "Destinatário não encontrado" }, { status: 404 });

  await db.dailySummaryRecipient.delete({ where: { id: recipientId } });
  return NextResponse.json({ success: true });
}
