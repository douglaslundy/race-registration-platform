import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildAdminAuditOrderBy, buildAdminAuditWhere, escapeCsvValue } from "@/lib/admin/audit";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action")?.trim() ?? "";
  const entity = searchParams.get("entity")?.trim() ?? "";
  const userId = searchParams.get("userId")?.trim() ?? "";
  const dateFrom = searchParams.get("dateFrom")?.trim() ?? "";
  const dateTo = searchParams.get("dateTo")?.trim() ?? "";
  const sort = searchParams.get("sort")?.trim() ?? "createdAt";
  const dir = searchParams.get("dir")?.trim() ?? "desc";

  const where = buildAdminAuditWhere({ action, entity, userId, dateFrom, dateTo });
  const orderBy = buildAdminAuditOrderBy(sort, dir).orderBy;

  const logs = await db.auditLog.findMany({
    where,
    orderBy,
    include: {
      user: { select: { name: true, email: true } },
    },
  });

  const header = ["Data", "Usuário", "Email", "Ação", "Entidade", "ID da entidade", "Metadata"]
    .map(escapeCsvValue)
    .join(",") + "\n";

  const rows = logs
    .map((log) =>
      [
        log.createdAt.toISOString(),
        log.user?.name ?? "Sistema",
        log.user?.email ?? "",
        log.action,
        log.entityType,
        log.entityId ?? "",
        log.metadata ? JSON.stringify(log.metadata) : "",
      ]
        .map(escapeCsvValue)
        .join(","),
    )
    .join("\n");

  return new NextResponse(header + rows, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="auditoria.csv"',
    },
  });
}
