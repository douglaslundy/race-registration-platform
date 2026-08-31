import { NextRequest, NextResponse } from "next/server";
import { checkApiPermission, resolveActingScope } from "@/lib/auth/rbac";
import { db } from "@/lib/db";

/** Remove um PDF de resultado. Não apaga o arquivo do bucket (mesma convenção de
 * banner/regulamento — o storage não é limpo hoje). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  const check = await checkApiPermission("results.import", { eventId: id });
  if (!check.allowed) return check.response;
  const { session } = check;

  const scope = await resolveActingScope(session);
  const event = scope.actingAsAdmin
    ? await db.event.findUnique({ where: { id } })
    : await db.event.findFirst({ where: { id, organizerId: scope.organizerId ?? "__none__" } });
  if (!event) return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });

  const file = await db.eventResultFile.findFirst({ where: { id: fileId, eventId: id } });
  if (!file) return NextResponse.json({ error: "Resultado não encontrado" }, { status: 404 });

  await db.eventResultFile.delete({ where: { id: fileId } });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "RESULT_FILE_DELETED",
      entityType: "EventResultFile",
      entityId: fileId,
      metadata: { eventId: id, label: file.label, fileName: file.fileName },
    },
  });

  return NextResponse.json({ ok: true });
}
